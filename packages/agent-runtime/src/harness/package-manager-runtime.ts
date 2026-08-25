import { constants } from "node:fs";
import { access, readFile, realpath } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { execa } from "execa";

export type PackageManagerName = "bun" | "npm" | "pnpm" | "yarn";

export type ResolvedPackageManager = {
  argsPrefix: string[];
  executable: string;
  readonlyRoots: string[];
};

const require = createRequire(import.meta.url);
const managedPackageNames = new Set<PackageManagerName>([
  "npm",
  "pnpm",
  "yarn",
]);

export async function resolvePackageManager(input: {
  name: PackageManagerName;
  version?: string;
}): Promise<ResolvedPackageManager> {
  const provisioned = await provisionedManager(input);
  if (provisioned) return provisioned;
  const bundled = await bundledManager(input);
  if (bundled) return bundled;
  const system = await systemManager(input);
  if (system) return system;
  const identity = input.version
    ? `${input.name}@${input.version}`
    : input.name;
  throw new Error(
    `PACKAGE_MANAGER_UNAVAILABLE:${identity} is not provisioned in this runtime. Corepack downloads are disabled.`,
  );
}

async function provisionedManager(input: {
  name: PackageManagerName;
  version?: string;
}) {
  if (!input.version) return undefined;
  for (const root of packageManagerRoots()) {
    const executable = join(root, input.name, input.version, "bin", input.name);
    if (await executableFile(executable))
      return {
        executable,
        argsPrefix: [],
        readonlyRoots: [dirname(dirname(executable))],
      };
  }
  return undefined;
}

async function bundledManager(input: {
  name: PackageManagerName;
  version?: string;
}) {
  if (!managedPackageNames.has(input.name)) return undefined;
  const manifestPath = bundledManifestPath(input.name);
  if (!manifestPath) return undefined;
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    bin?: Record<string, string> | string;
    version?: string;
  };
  if (input.version && manifest.version !== input.version) return undefined;
  const entry = managerBin(manifest.bin, input.name);
  if (!entry) return undefined;
  const packageRoot = dirname(manifestPath);
  return {
    executable: process.env.BLAME_NODE_EXECUTABLE?.trim() || "node",
    argsPrefix: [join(packageRoot, entry)],
    readonlyRoots: [packageRoot],
  };
}

function bundledManifestPath(name: PackageManagerName) {
  try {
    if (name === "pnpm") return require.resolve("pnpm");
    if (name === "npm")
      return join(dirname(require.resolve("npm")), "package.json");
    if (name === "yarn") return require.resolve("yarn/package.json");
    return undefined;
  } catch {
    return undefined;
  }
}

function managerBin(
  value: Record<string, string> | string | undefined,
  name: PackageManagerName,
) {
  if (typeof value === "string") return value;
  return value?.[name];
}

async function systemManager(input: {
  name: PackageManagerName;
  version?: string;
}) {
  for (const root of systemPathRoots()) {
    const candidate = join(root, input.name);
    if (!(await executableFile(candidate))) continue;
    const executable = await realpath(candidate);
    if (isCorepackShim(executable)) continue;
    if (!(await managerVersionMatches(executable, input.version))) continue;
    return { executable, argsPrefix: [], readonlyRoots: [dirname(executable)] };
  }
  return undefined;
}

async function managerVersionMatches(executable: string, expected?: string) {
  if (!expected) return true;
  const result = await execa(executable, ["--version"], {
    reject: false,
    timeout: 5_000,
    stdin: "ignore",
  });
  return !result.failed && String(result.stdout).trim() === expected;
}

function packageManagerRoots() {
  const configured = process.env.BLAME_PACKAGE_MANAGER_ROOT?.trim();
  return [
    ...new Set([configured, "/opt/blame/package-managers"].filter(Boolean)),
  ] as string[];
}

function systemPathRoots() {
  return (process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin")
    .split(delimiter)
    .filter(Boolean)
    .map((path) => resolve(path));
}

function isCorepackShim(path: string) {
  return /(?:^|[/\\])corepack(?:[/\\]|$)/iu.test(path);
}

async function executableFile(path: string) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
