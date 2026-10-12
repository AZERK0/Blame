import { lstat, mkdir, mkdtemp, readFile, readdir, realpath } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "./light-identity.js";
import type { NodeEventBinding } from "./node-event-evidence.js";
import type { TaskCatalogItem, TaskInvocation } from "./task-catalog.js";
import { executeWorkspaceCommand } from "./workspace-command-process.js";

export type ManagedTestReport = {
  command: string;
  invocation: TaskInvocation;
  read(): Promise<string | string[] | undefined>;
  nodeEvents?: Omit<NodeEventBinding, "report">;
};

/** Adds a report only to a catalogued runner whose installed version was identified. */
export async function managedTestReport(
  task: TaskCatalogItem,
  invocation: TaskInvocation,
  workspaceRoot: string,
  sequence: number,
  signal?: AbortSignal,
): Promise<ManagedTestReport | undefined> {
  const adapter = managedNodeAdapter(task, invocation) ?? managedAdapter(task, invocation);
  if (!adapter) return undefined;
  const cwd = resolve(workspaceRoot, invocation.cwd);
  const version = await executeWorkspaceCommand(
    adapter.versionExecutable ?? invocation.executable,
    adapter.versionArgs,
    { cwd, signal, timeoutMs: 5_000, maximumOutputBytes: 4_096 },
  );
  if (version.failed || !adapter.supported(version.all))
    return undefined;
  const parent = join(
    workspaceRoot,
    ".blame",
    "harness",
    "test-results",
  );
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, `${adapter.name}-${process.pid}-${sequence}-`));
  const reportPath = join(directory, adapter.file);
  const args = adapter.args(invocation.args, directory, reportPath);
  return {
    invocation: { ...invocation, args },
    command: [invocation.executable, ...args].join(" "),
    read: () => adapter.read(directory, reportPath),
    ...(adapter.name === "node" ? { nodeEvents: { invocationId: basename(directory),
      reporterSha256: sha256(await readFile(fileURLToPath(new URL("./node-event-reporter.js", import.meta.url)))) } } : {}),
  };
}

type ManagedAdapter = {
  args(args: string[], directory: string, reportPath: string): string[];
  file: string;
  name: string;
  read(directory: string, reportPath: string): Promise<string | string[] | undefined>;
  supported(output: string): boolean;
  versionArgs: string[];
  versionExecutable?: string;
};

function managedNodeAdapter(task: TaskCatalogItem, invocation: TaskInvocation): ManagedAdapter | undefined {
  if (task.kind !== "test" || invocation.args.some(arg =>
    /^(?:--test-reporter|--test-isolation|--watch)/u.test(arg))) return undefined;
  const native = task.invocation && basename(invocation.executable) === "node" &&
    invocation.args[0] === "--test";
  const npm = !task.invocation && task.package_manager === "npm" && task.command === "node --test" &&
    invocation.args[0] === "run" && invocation.args[1] === task.script &&
    (invocation.args.length === 2 || invocation.args[2] === "--");
  if (!native && !npm) return undefined;
  const reporter = fileURLToPath(new URL("./node-event-reporter.js", import.meta.url));
  return { name: "node", file: "events.jsonl", versionExecutable: native ? invocation.executable : "node",
    versionArgs: ["--version"], supported: output => /^v24\./u.test(output.trim()),
    args: (args, _directory, reportPath) => {
      const extra = ["--test-reporter=spec", `--test-reporter=${reporter}`,
        "--test-reporter-destination=stdout", `--test-reporter-destination=${reportPath}`];
      return native ? [args[0]!, ...extra, ...args.slice(1)]
        : [args[0]!, args[1]!, "--", ...extra, ...args.slice(3)];
    }, read: readOwnedReport };
}

function managedAdapter(
  task: TaskCatalogItem,
  invocation: TaskInvocation,
): ManagedAdapter | undefined {
  if (task.kind !== "test" || !task.invocation) return undefined;
  const executable = basename(invocation.executable);
  if (
    /^python(?:3(?:\.\d+)*)?$/u.test(executable) &&
    invocation.args.length === 2 &&
    invocation.args[0] === "-m" &&
    invocation.args[1] === "pytest"
  )
    return {
      name: "pytest",
      file: "junit.xml",
      versionArgs: ["-m", "pytest", "--version"],
      supported: (output) => supportedMajor(output, /pytest\s+(\d+)/u, 6, 9),
      args: (args, _directory, reportPath) => [
        ...args,
        `--junitxml=${reportPath}`,
      ],
      read: readOwnedReport,
    };
  if (executable === "dotnet" && invocation.args[0] === "test")
    return {
      name: "vstest",
      file: "results.trx",
      versionArgs: ["--version"],
      supported: (output) => supportedMajor(output, /^(\d+)\./u, 6, 10),
      args: (args, directory) => [
        ...args,
        "--logger",
        "trx;LogFileName=results.trx",
        "--results-directory",
        directory,
      ],
      read: readOwnedReport,
    };
  if ((executable === "mvn" || executable === "mvnw") && invocation.args.includes("test"))
    return {
      name: "surefire",
      file: "TEST-*.xml",
      versionArgs: ["--version"],
      supported: (output) => supportedMajor(output, /Apache Maven (\d+)\./u, 3, 4),
      args: (args, directory) => [
        ...args,
        `-Dsurefire.reportsDirectory=${directory}`,
      ],
      read: readOwnedReports,
    };
  return undefined;
}

function supportedMajor(
  output: string,
  expression: RegExp,
  minimum: number,
  maximum: number,
) {
  const major = expression.exec(output)?.[1];
  return Boolean(major && Number(major) >= minimum && Number(major) <= maximum);
}

async function readOwnedReport(directory: string, path: string) {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024)
      return undefined;
    const [ownedDirectory, actual] = await Promise.all([
      realpath(directory),
      realpath(path),
    ]);
    if (!actual.startsWith(`${ownedDirectory}${sep}`)) return undefined;
    return await readFile(actual, "utf8");
  } catch {
    return undefined;
  }
}

async function readOwnedReports(directory: string) {
  try {
    const names = (await readdir(directory))
      .filter((name) => /^TEST-[^/\\]+\.xml$/u.test(name))
      .sort()
      .slice(0, 1_000);
    const reports = await Promise.all(
      names.map((name) => readOwnedReport(directory, join(directory, name))),
    );
    return reports.length && reports.every(Boolean)
      ? (reports as string[])
      : undefined;
  } catch {
    return undefined;
  }
}
