import { constants } from "node:fs";
import { access, readFile, readdir, realpath } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { execa } from "execa";

export type PackageManagerName = "bun" | "npm" | "pnpm" | "yarn";
export type PackageManagerCompatibility = "exact" | "pnpm_same_major";

export type ResolvedPackageManager = {
  argsPrefix: string[];
  executable: string;
  readonlyRoots: string[];
  requestedVersion?: string;
  resolvedVersion: string;
  resolutionStrategy: "compatible_same_major" | "exact" | "unversioned";
};

type PackageManagerCandidate = Pick<
  ResolvedPackageManager,
  "argsPrefix" | "executable" | "readonlyRoots" | "resolvedVersion"
>;

type PackageManagerRequest = {
  compatibility?: PackageManagerCompatibility;
  name: PackageManagerName;
  version?: string;
};

const require = createRequire(import.meta.url);
const managedPackageNames = new Set<PackageManagerName>([
  "npm",
  "pnpm",
  "yarn",
]);

export async function resolvePackageManager(
  input: PackageManagerRequest,
): Promise<ResolvedPackageManager> {
  const exact = await exactManager(input);
  if (exact)
    return resolvedManager(
      exact,
      input,
      input.version ? "exact" : "unversioned",
    );
  const compatible = await compatibleManager(input);
  if (compatible)
    return resolvedManager(compatible, input, "compatible_same_major");
  const identity = input.version
    ? `${input.name}@${input.version}`
    : input.name;
  const compatibility =
    input.compatibility === "pnpm_same_major"
      ? " No trusted stable pnpm from the requested major is available."
      : "";
  throw new Error(
    `PACKAGE_MANAGER_UNAVAILABLE:${identity} is not provisioned in this runtime.${compatibility} Corepack and package-manager self-downloads are disabled.`,
  );
}

async function exactManager(input: PackageManagerRequest) {
  return (
    (await provisionedManager(input)) ??
    (await bundledManager(input)) ??
    (await systemManager(input))
  );
}

async function provisionedManager(input: PackageManagerRequest) {
  if (!input.version) return undefined;
  for (const root of packageManagerRoots()) {
    const executable = join(root, input.name, input.version, "bin", input.name);
    if (
      (await executableFile(executable)) &&
      (await managerVersion(executable)) === input.version
    )
      return {
        executable,
        argsPrefix: [],
        readonlyRoots: [dirname(dirname(executable))],
        resolvedVersion: input.version,
      };
  }
  return undefined;
}

async function bundledManager(input: PackageManagerRequest) {
  if (!managedPackageNames.has(input.name)) return undefined;
  const manifestPath = bundledManifestPath(input.name);
  if (!manifestPath) return undefined;
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    bin?: Record<string, string> | string;
    version?: string;
  };
  if (
    !manifest.version ||
    (input.version && manifest.version !== input.version)
  )
    return undefined;
  const entry = managerBin(manifest.bin, input.name);
  if (!entry) return undefined;
  const packageRoot = dirname(manifestPath);
  return {
    executable: process.env.BLAME_NODE_EXECUTABLE?.trim() || process.execPath,
    argsPrefix: [join(packageRoot, entry)],
    readonlyRoots: [packageRoot],
    resolvedVersion: manifest.version,
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

async function systemManager(input: PackageManagerRequest) {
  for (const root of systemPathRoots()) {
    const candidate = join(root, input.name);
    if (!(await executableFile(candidate))) continue;
    const executable = await realpath(candidate);
    if (isCorepackShim(executable)) continue;
    const resolvedVersion = await managerVersion(executable);
    if (
      !resolvedVersion ||
      (input.version && resolvedVersion !== input.version)
    )
      continue;
    return {
      executable,
      argsPrefix: [],
      readonlyRoots: [dirname(executable)],
      resolvedVersion,
    };
  }
  return undefined;
}

async function managerVersion(executable: string) {
  const result = await execa(executable, ["--version"], {
    reject: false,
    timeout: 5_000,
    stdin: "ignore",
  });
  return result.failed ? undefined : String(result.stdout).trim();
}

async function compatibleManager(input: PackageManagerRequest) {
  if (
    input.name !== "pnpm" ||
    input.compatibility !== "pnpm_same_major" ||
    !input.version
  )
    return undefined;
  const compatibility = input.compatibility;
  const requestedVersion = input.version;
  const requested = semanticVersion(requestedVersion);
  if (!requested) return undefined;
  const candidates = await compatibleCandidates(input.name);
  return candidates
    .filter((candidate) =>
      packageManagerVersionsCompatible({
        candidateVersion: candidate.resolvedVersion,
        compatibility,
        name: input.name,
        requestedVersion,
      }),
    )
    .sort((left, right) =>
      compareCandidateProximity(left, right, requested),
    )[0];
}

export function packageManagerVersionsCompatible(input: {
  candidateVersion: string;
  compatibility: PackageManagerCompatibility;
  name: PackageManagerName;
  requestedVersion: string;
}) {
  if (input.name !== "pnpm" || input.compatibility !== "pnpm_same_major")
    return false;
  const requested = semanticVersion(input.requestedVersion);
  const candidate = semanticVersion(input.candidateVersion);
  return Boolean(requested && candidate && requested.major === candidate.major);
}

async function compatibleCandidates(name: PackageManagerName) {
  const provisioned = await provisionedManagerCandidates(name);
  const bundled = await bundledManager({ name });
  const system = await systemManager({ name });
  return uniqueCandidates([
    ...provisioned,
    ...(bundled ? [bundled] : []),
    ...(system ? [system] : []),
  ]);
}

async function provisionedManagerCandidates(name: PackageManagerName) {
  const candidates: PackageManagerCandidate[] = [];
  for (const root of packageManagerRoots()) {
    const versions = await directoryNames(join(root, name));
    for (const version of versions) {
      const candidate = await provisionedManager({ name, version });
      if (candidate) candidates.push(candidate);
    }
  }
  return candidates;
}

function resolvedManager(
  candidate: PackageManagerCandidate,
  input: PackageManagerRequest,
  resolutionStrategy: ResolvedPackageManager["resolutionStrategy"],
): ResolvedPackageManager {
  return {
    ...candidate,
    ...(input.version ? { requestedVersion: input.version } : {}),
    resolutionStrategy,
  };
}

function semanticVersion(value: string) {
  const match = value.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u);
  if (!match) return undefined;
  const [major, minor, patch] = match.slice(1).map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) return undefined;
  return {
    major,
    minor,
    patch,
  };
}

function compareCandidateProximity(
  left: PackageManagerCandidate,
  right: PackageManagerCandidate,
  requested: NonNullable<ReturnType<typeof semanticVersion>>,
) {
  const leftVersion = semanticVersion(left.resolvedVersion)!;
  const rightVersion = semanticVersion(right.resolvedVersion)!;
  const minorDifference =
    Math.abs(leftVersion.minor - requested.minor) -
    Math.abs(rightVersion.minor - requested.minor);
  if (minorDifference !== 0) return minorDifference;
  return (
    Math.abs(leftVersion.patch - requested.patch) -
    Math.abs(rightVersion.patch - requested.patch)
  );
}

function uniqueCandidates(candidates: PackageManagerCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.executable}\0${candidate.resolvedVersion}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function directoryNames(path: string) {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
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
