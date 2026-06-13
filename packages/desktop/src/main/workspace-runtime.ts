import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { existsSync } from "node:fs";
import {
  appendFile as appendHostFile,
  chmod as chmodHost,
  mkdir as mkdirHost,
  readFile as readHostFile,
  rm as rmHost,
  writeFile as writeHostFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, posix, resolve, win32 } from "node:path";
import { promisify } from "node:util";
import { runtimeToolScript, setupPath } from "./host-tool-path.ts";

const execFileAsync = promisify(execFile);
const vmRuntimeWorktreeRoot = "/home/blame/.local/share/blame/runtime/worktrees";

type RuntimeOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
};

type RuntimeCommandSpec = {
  args: string[];
  command: string;
  cwd?: string;
};

export function worktreeRoot(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
) {
  return platformWorktreeRoot(platform, env);
}

export function worktreePath(input: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  repositoryRoot: string;
  storyId: number;
  title: string;
}) {
  const repositoryName = repositoryBasename(
    input.repositoryRoot,
    input.platform ?? process.platform,
  );
  const slug = storySlug(input.storyId, input.title);
  return posix.join(
    platformWorktreeRoot(input.platform, input.env),
    repositoryName,
    `story-${input.storyId}-${slug}`,
  );
}

export function storyBranch(storyId: number, title: string) {
  return `blame/story-${storyId}-${storySlug(storyId, title)}`;
}

export function storySlug(storyId: number, title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || `story-${storyId}`;
}

export function runtimeManagedPath(
  path: string,
  platform: NodeJS.Platform = process.platform,
) {
  if (platform !== "darwin" && platform !== "win32") return false;
  return normalizedRuntimePath(path) === vmRuntimeWorktreeRoot
    || normalizedRuntimePath(path).startsWith(`${vmRuntimeWorktreeRoot}/`);
}

export function resolveWorkspacePath(path: string) {
  if (runtimePathLike(path))
    return normalizedRuntimePath(path);
  return resolve(path);
}

export function joinWorkspacePath(root: string, ...paths: string[]) {
  if (runtimePathLike(root))
    return posix.join(normalizedRuntimePath(root), ...paths);
  return joinHostPath(root, ...paths);
}

export function dirnameWorkspacePath(path: string) {
  if (runtimePathLike(path))
    return posix.dirname(normalizedRuntimePath(path));
  return dirname(path);
}

export function runtimeCommand(
  command: string,
  args: string[],
  input: RuntimeOptions = {},
): RuntimeCommandSpec {
  const platform = input.platform ?? process.platform;
  if (platform === "darwin")
    return runtimeWrappedCommand("blame-lima-runtime", command, args, input.cwd);
  if (platform === "win32")
    return runtimeWrappedCommand("blame-wsl2-runtime", command, args, input.cwd);
  return { args, command, cwd: input.cwd };
}

export async function run(
  command: string,
  args: string[],
  input: RuntimeOptions = {},
) {
  const spec = runtimeCommand(command, args, input);
  const platform = input.platform ?? process.platform;
  const env = runtimeEnvironment(input, platform);
  const commandSpec = executableRuntimeCommand(spec, platform, env);
  const result = await execFileAsync(commandSpec.command, commandSpec.args, {
    cwd: spec.cwd,
    env,
    shell: false,
  });
  return {
    stderr: String(result.stderr),
    stdout: String(result.stdout),
  };
}

export function spawnRuntime(
  command: string,
  args: string[],
  input: RuntimeOptions = {},
): ChildProcessWithoutNullStreams {
  const spec = runtimeCommand(command, args, input);
  const platform = input.platform ?? process.platform;
  const env = runtimeEnvironment(input, platform);
  const commandSpec = executableRuntimeCommand(spec, platform, env);
  return spawn(commandSpec.command, commandSpec.args, {
    cwd: spec.cwd,
    detached: platform !== "win32",
    env,
    shell: false,
  });
}

export async function pathExists(path: string, input: RuntimeOptions = {}) {
  if (!runtimeManagedPath(path, input.platform)) return existsSync(path);
  try {
    await run("test", ["-e", path], input);
    return true;
  } catch {
    return false;
  }
}

export async function mkdir(path: string, input: RuntimeOptions = {}) {
  if (!runtimeManagedPath(path, input.platform)) {
    await mkdirHost(path, { recursive: true });
    return;
  }
  await run("mkdir", ["-p", path], input);
}

export async function rm(path: string, input: RuntimeOptions = {}) {
  if (!runtimeManagedPath(path, input.platform)) {
    await rmHost(path, { force: true, recursive: true });
    return;
  }
  await run("rm", ["-rf", path], input);
}

export async function readFile(path: string, input: RuntimeOptions = {}) {
  if (!runtimeManagedPath(path, input.platform)) return readHostFile(path, "utf8");
  const { stdout } = await run("cat", [path], input);
  return stdout;
}

export async function readDirectory(path: string, input: RuntimeOptions = {}) {
  const { stdout } = await run(
    "find",
    [path, "-mindepth", "1", "-maxdepth", "1", "-printf", "%f\t%y\n"],
    input,
  );
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, type] = line.split("\t", 2);
      return {
        isDirectory: () => type === "d",
        isFile: () => type === "f",
        name,
      };
    });
}

export async function writeFile(
  path: string,
  data: string,
  input: RuntimeOptions = {},
) {
  if (!runtimeManagedPath(path, input.platform)) {
    await writeHostFile(path, data, "utf8");
    return;
  }
  await mkdir(dirname(path), input);
  const encoded = Buffer.from(data, "utf8").toString("base64");
  await run(
    "sh",
    ["-lc", `printf %s ${shellQuote(encoded)} | base64 -d > ${shellQuote(path)}`],
    input,
  );
}

export async function appendFile(
  path: string,
  data: string,
  input: RuntimeOptions = {},
) {
  if (!runtimeManagedPath(path, input.platform)) {
    await appendHostFile(path, data, "utf8");
    return;
  }
  await mkdir(dirname(path), input);
  const encoded = Buffer.from(data, "utf8").toString("base64");
  await run(
    "sh",
    [
      "-lc",
      `printf %s ${shellQuote(encoded)} | base64 -d >> ${shellQuote(path)}`,
    ],
    input,
  );
}

export async function chmod(path: string, mode: number, input: RuntimeOptions = {}) {
  if (!runtimeManagedPath(path, input.platform)) {
    await chmodHost(path, mode);
    return;
  }
  await run("chmod", [mode.toString(8), path], input);
}

function runtimeWrappedCommand(
  wrapper: string,
  command: string,
  args: string[],
  cwd?: string,
): RuntimeCommandSpec {
  if (!cwd) return { args: [command, ...args], command: wrapper };
  return {
    args: [
      "sh",
      "-lc",
      `cd ${shellQuote(cwd)} && exec ${shellQuote(command)} ${args.map(shellQuote).join(" ")}`,
    ],
    command: wrapper,
  };
}

function runtimeEnvironment(
  input: RuntimeOptions,
  platform: NodeJS.Platform,
) {
  return input.env ?? {
    ...process.env,
    PATH: setupPath({ platform }),
  };
}

function executableRuntimeCommand(
  spec: RuntimeCommandSpec,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
) {
  if (platform !== "win32") return spec;
  const script = runtimeToolScript(spec.command, { env, platform });
  if (script) {
    return {
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...spec.args],
      command: "powershell.exe",
    };
  }
  return {
    args: ["/d", "/s", "/c", commandPromptLine(spec.command, spec.args, env)],
    command: "cmd.exe",
  };
}

function commandPromptLine(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
) {
  return [
    "call",
    commandPromptQuote(windowsBatchCommand(command)),
    ...args.map(commandPromptQuote),
  ].join(" ");
}

function windowsBatchCommand(command: string) {
  if (command === "blame-wsl2-runtime") return "blame-wsl2-runtime.cmd";
  if (command === "blame-lima-runtime") return "blame-lima-runtime.cmd";
  return command;
}

function commandPromptQuote(value: string) {
  return `"${value.replace(/(["^&|<>])/g, "^$1")}"`;
}

function repositoryBasename(path: string, platform: NodeJS.Platform) {
  if (platform === "win32") return win32.basename(path);
  return basename(path);
}

function joinHostPath(root: string, ...paths: string[]) {
  return join(root, ...paths);
}

function platformWorktreeRoot(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (platform === "darwin" || platform === "win32") return vmRuntimeWorktreeRoot;
  const home = env.HOME || homedir() || "/home/blame";
  return posix.join(
    home.replace(/\\/g, "/"),
    ".local",
    "share",
    "blame",
    "runtime",
    "worktrees",
  );
}

function runtimePathLike(path: string) {
  const normalized = normalizedRuntimePath(path);
  return (
    normalized === vmRuntimeWorktreeRoot ||
    normalized.startsWith(`${vmRuntimeWorktreeRoot}/`) ||
    normalized.includes("/.local/share/blame/runtime/worktrees/")
  );
}

function normalizedRuntimePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/g, "");
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
