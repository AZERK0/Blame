import { createHash } from "node:crypto";
import { constants as fileSystemConstants } from "node:fs";
import { createRequire } from "node:module";
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import fg from "fast-glob";
import writeFileAtomic from "write-file-atomic";
import {
  dependencyCacheRoot,
  readDependencyCacheManifest,
  writeDependencyCacheManifest,
  type DependencyCacheManifest,
  type DependencyIntegrityProbe,
  type DependencyPersistence,
} from "./dependency-cache.js";
import {
  environmentSpec,
  type EnvironmentSpec,
} from "./environment-service.js";
import { sha256 } from "./protocol.js";
import type { TaskCatalogItem } from "./schemas.js";
import type { WorkspaceFiles, WorkspaceSnapshot } from "./workspace-files.js";

const environmentManifestName = "environment-manifest.json";

export type DependencyEnvironment = {
  root: string;
  workspace: string;
  spec: EnvironmentSpec;
  integrity_probe: DependencyIntegrityProbe;
  persistence?: DependencyPersistence;
};

export type { DependencyPersistence } from "./dependency-cache.js";

export class DependencyEnvironmentService {
  private readonly root: string;

  constructor(workspaceRoot: string) {
    this.root = join(
      workspaceRoot,
      ".blame",
      "harness",
      "dependency-environments",
    );
  }

  async current(
    files: WorkspaceFiles,
    snapshot: WorkspaceSnapshot,
    task: TaskCatalogItem,
  ) {
    const ready = await this.inspect(files, snapshot, task);
    if (!ready) return undefined;
    await activateDependencyEnvironment(
      files.root,
      ready.workspace,
      snapshot.files,
    );
    return ready;
  }

  async inspect(
    files: WorkspaceFiles,
    snapshot: WorkspaceSnapshot,
    task: TaskCatalogItem,
  ) {
    const cacheRoot = await dependencyCacheRoot(
      files.root,
      snapshot.files,
      task,
    );
    const cache = await readDependencyCacheManifest(cacheRoot);
    if (!cache || cache.integrity_probe.status !== "passed") return undefined;
    const spec = await environmentSpec(files, snapshot, {
      dependencyVolumeDigest: cache.dependency_digest,
      packageManager: task.package_manager,
      resolvedPackageManagerVersion: cache.resolved_version,
    });
    const environment = await this.read(spec.environment_revision_id);
    if (!environment) return undefined;
    const probe = await probeDependencyEnvironment(
      environment.workspace,
      snapshot.files,
    );
    if (probe.status !== "passed") return undefined;
    return { ...environment, integrity_probe: probe };
  }

  async persist(input: {
    files: WorkspaceFiles;
    snapshot: WorkspaceSnapshot;
    sourceWorkspace: string;
    task: TaskCatalogItem;
    resolvedVersion: string;
    requiredPackages?: string[];
  }) {
    const dependencyVolumeDigest = await installedDependencyDigest(
      input.sourceWorkspace,
      input.snapshot.files,
    );
    const spec = await environmentSpec(input.files, input.snapshot, {
      dependencyVolumeDigest,
      packageManager: input.task.package_manager,
      resolvedPackageManagerVersion: input.resolvedVersion,
    });
    const existing = await this.read(spec.environment_revision_id);
    if (existing) {
      const probe = await probeDependencyEnvironment(
        existing.workspace,
        input.snapshot.files,
        input.requiredPackages,
      );
      if (probe.status === "passed") {
        const ready = { ...existing, integrity_probe: probe };
        await activateDependencyEnvironment(
          input.files.root,
          ready.workspace,
          input.snapshot.files,
        );
        return ready;
      }
    }
    const created = await this.create({
      ...input,
      dependencyVolumeDigest,
      spec,
    });
    await activateDependencyEnvironment(
      input.files.root,
      created.workspace,
      input.snapshot.files,
    );
    return created;
  }

  async invalidate(environmentRevisionId: string) {
    const target = this.environmentRoot(environmentRevisionId);
    const invalid = `${target}.invalid-${Date.now()}`;
    try {
      await rename(target, invalid);
      return invalid;
    } catch (error) {
      if (errorCode(error) === "ENOENT") return undefined;
      throw error;
    }
  }

  private async create(input: {
    files: WorkspaceFiles;
    snapshot: WorkspaceSnapshot;
    sourceWorkspace: string;
    task: TaskCatalogItem;
    resolvedVersion: string;
    requiredPackages?: string[];
    dependencyVolumeDigest: string;
    spec: EnvironmentSpec;
  }) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const staging = await mkdtemp(join(this.root, ".staging-"));
    const workspace = join(staging, "workspace");
    await mkdir(workspace, { recursive: true, mode: 0o700 });
    try {
      await copyDependencyMetadata(
        input.sourceWorkspace,
        workspace,
        input.snapshot.files,
      );
      const persistence = await copyDependencyDirectories(
        input.sourceWorkspace,
        workspace,
        input.snapshot.files,
      );
      const probe = await probeDependencyEnvironment(
        workspace,
        input.snapshot.files,
        input.requiredPackages,
      );
      if (probe.status !== "passed")
        throw new Error(
          `DEPENDENCY_INTEGRITY_PROBE_FAILED:${probe.failure_signature}`,
        );
      const manifest = {
        spec: input.spec,
        integrity_probe: probe,
        persistence,
      };
      await writeFileAtomic(
        join(staging, environmentManifestName),
        JSON.stringify(manifest),
        { fsync: true, mode: 0o600 },
      );
      const target = this.environmentRoot(input.spec.environment_revision_id);
      await rename(staging, target).catch(async (error) => {
        if (errorCode(error) !== "EEXIST") throw error;
        await rm(staging, { force: true, recursive: true });
      });
      await this.writeCacheManifest(input, probe, persistence);
      return (await this.read(input.spec.environment_revision_id))!;
    } catch (error) {
      await rm(staging, { force: true, recursive: true });
      throw error;
    }
  }

  private async writeCacheManifest(
    input: {
      files: WorkspaceFiles;
      snapshot: WorkspaceSnapshot;
      task: TaskCatalogItem;
      resolvedVersion: string;
      spec: EnvironmentSpec;
    },
    probe: DependencyIntegrityProbe,
    persistence: DependencyPersistence,
  ) {
    const cacheRoot = await dependencyCacheRoot(
      input.files.root,
      input.snapshot.files,
      input.task,
    );
    const manifest: DependencyCacheManifest = {
      schema_version: "1.0",
      dependency_digest: input.spec.dependency_volume_digest,
      package_manager: input.task.package_manager,
      resolved_version: input.resolvedVersion,
      platform: process.platform,
      architecture: process.arch,
      runtime_target: input.spec.runtime_target,
      created_at: new Date().toISOString(),
      integrity_probe: probe,
      persistence,
    };
    await writeDependencyCacheManifest(cacheRoot, manifest);
  }

  private async read(environmentRevisionId: string) {
    const root = this.environmentRoot(environmentRevisionId);
    try {
      const value = JSON.parse(
        await readFile(join(root, environmentManifestName), "utf8"),
      ) as {
        spec?: EnvironmentSpec;
        integrity_probe?: DependencyIntegrityProbe;
        persistence?: DependencyPersistence;
      };
      if (
        value.spec?.environment_revision_id !== environmentRevisionId ||
        value.integrity_probe?.status !== "passed"
      )
        return undefined;
      return {
        root,
        workspace: join(root, "workspace"),
        spec: value.spec,
        integrity_probe: value.integrity_probe,
        ...(value.persistence ? { persistence: value.persistence } : {}),
      } satisfies DependencyEnvironment;
    } catch (error) {
      if (errorCode(error) === "ENOENT") return undefined;
      throw error;
    }
  }

  private environmentRoot(environmentRevisionId: string) {
    if (!/^env_[a-f0-9]{32}$/u.test(environmentRevisionId))
      throw new Error("INVALID_ENVIRONMENT_REVISION");
    return join(this.root, environmentRevisionId);
  }
}

async function activateDependencyEnvironment(
  worktree: string,
  environmentWorkspace: string,
  files: string[],
) {
  for (const directory of packageDirectories(files)) {
    const target = join(environmentWorkspace, directory, "node_modules");
    try {
      await lstat(target);
    } catch (error) {
      if (errorCode(error) === "ENOENT") continue;
      throw error;
    }
    await activateDependencyDirectory(
      worktree,
      join(worktree, directory, "node_modules"),
      target,
    );
  }
}

async function activateDependencyDirectory(
  worktree: string,
  destination: string,
  target: string,
) {
  try {
    if ((await realpath(destination)) === (await realpath(target))) return;
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  const backup = join(
    worktree,
    ".blame",
    "harness",
    "dependency-backups",
    sha256(destination),
  );
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await mkdir(dirname(backup), { recursive: true, mode: 0o700 });
  let moved = false;
  try {
    await rename(destination, backup);
    moved = true;
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  try {
    await symlink(target, destination, "junction");
    if (moved) await rm(backup, { force: true, recursive: true });
  } catch (error) {
    if (moved) await rename(backup, destination);
    throw error;
  }
}

export async function probeDependencyEnvironment(
  workspace: string,
  sourceFiles: string[],
  requiredPackages: string[] = [],
): Promise<DependencyIntegrityProbe> {
  const declaredPackages = await directPackages(workspace, sourceFiles);
  const packages = new Set([...declaredPackages, ...requiredPackages]);
  const packageResults = await resolvePackages(
    workspace,
    sourceFiles,
    packages,
  );
  const expectedExecutables = await declaredExecutables(
    workspace,
    sourceFiles,
    declaredPackages,
  );
  const executableResults = await resolveExecutables(
    workspace,
    sourceFiles,
    expectedExecutables,
  );
  const symlinksPresent = await symlinkTargetsPresent(workspace);
  const storePresent =
    packages.size === 0 || (await dependencyStorePresent(workspace));
  const passed =
    Object.values(packageResults).every(Boolean) &&
    Object.values(executableResults).every(Boolean) &&
    symlinksPresent &&
    storePresent;
  const failureSignature = passed
    ? undefined
    : sha256(
        JSON.stringify({
          executables: executableResults,
          packages: packageResults,
          storePresent,
          symlinksPresent,
        }),
      );
  return {
    status: passed ? "passed" : "failed",
    cwd: workspace,
    executables: executableResults,
    packages: packageResults,
    symlink_targets_present: symlinksPresent,
    store_present: storePresent,
    checked_at: new Date().toISOString(),
    ...(failureSignature ? { failure_signature: failureSignature } : {}),
  };
}

export function declaredDependencyPackages(
  workspace: string,
  sourceFiles: string[],
) {
  return directPackages(workspace, sourceFiles);
}

async function copyDependencyDirectories(
  sourceRoot: string,
  destinationRoot: string,
  files: string[],
) {
  const startedAt = Date.now();
  let copied = 0;
  for (const directory of packageDirectories(files)) {
    const source = join(sourceRoot, directory, "node_modules");
    try {
      const sourceEntry = await lstat(source);
      const copySource = sourceEntry.isSymbolicLink()
        ? await realpath(source)
        : source;
      if (!(await lstat(copySource)).isDirectory()) continue;
      const destination = join(destinationRoot, directory, "node_modules");
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await cp(copySource, destination, {
        dereference: false,
        force: false,
        mode: fileSystemConstants.COPYFILE_FICLONE,
        preserveTimestamps: true,
        recursive: true,
        verbatimSymlinks: true,
      });
      copied += 1;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
  }
  if (!copied) {
    const emptyRoot = join(destinationRoot, "node_modules");
    await mkdir(emptyRoot, { recursive: true, mode: 0o700 });
    await writeFileAtomic(join(emptyRoot, ".blame-environment"), "empty", {
      mode: 0o600,
    });
  }
  return {
    strategy: "reflink_with_copy_fallback" as const,
    duration_ms: Math.max(0, Date.now() - startedAt),
    directories: copied,
  };
}

async function copyDependencyMetadata(
  sourceRoot: string,
  destinationRoot: string,
  files: string[],
) {
  for (const path of files.filter(isDependencyMetadata)) {
    const destination = join(destinationRoot, path);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await cp(join(sourceRoot, path), destination, { force: false });
  }
}

async function installedDependencyDigest(root: string, files: string[]) {
  const hash = createHash("sha256");
  const entries = await fg(
    packageDirectories(files).flatMap((directory) => {
      const prefix = directory === "." ? "" : `${directory}/`;
      return [
        `${prefix}node_modules/.bin/*`,
        `${prefix}node_modules/.pnpm/lock.yaml`,
        `${prefix}node_modules/.package-lock.json`,
      ];
    }),
    { cwd: root, dot: true, followSymbolicLinks: false, unique: true },
  );
  for (const path of entries.sort()) {
    hash.update(path);
    hash.update("\0");
    const absolute = join(root, path);
    const info = await lstat(absolute);
    hash.update(`${info.mode}:${info.size}`);
    if (info.isSymbolicLink()) hash.update(await realpath(absolute));
    hash.update("\0");
  }
  if (!entries.length) hash.update("empty-dependency-volume");
  return hash.digest("hex");
}

async function directPackages(root: string, files: string[]) {
  const names = new Set<string>();
  for (const path of files.filter(isPackageManifest)) {
    const manifest = JSON.parse(
      await readFile(join(root, path), "utf8"),
    ) as Record<string, unknown>;
    for (const field of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
    ]) {
      const dependencies = manifest[field];
      if (!dependencies || typeof dependencies !== "object") continue;
      Object.keys(dependencies).forEach((name) => names.add(name));
    }
  }
  return names;
}

async function resolvePackages(
  root: string,
  files: string[],
  packages: Set<string>,
) {
  const manifests = files.filter(isPackageManifest);
  const result: Record<string, boolean> = {};
  for (const name of [...packages].sort()) {
    result[name] = manifests.some((path) => {
      const resolver = createRequire(join(root, path));
      try {
        resolver.resolve(name);
        return true;
      } catch {
        return false;
      }
    });
  }
  return result;
}

async function resolveExecutables(
  root: string,
  files: string[],
  expected: Set<string>,
) {
  const result: Record<string, boolean> = {};
  const bins = packageDirectories(files).map((directory) =>
    join(root, directory, "node_modules", ".bin"),
  );
  for (const executable of [...expected].sort())
    result[executable] = await anyExecutablePresent(bins, executable);
  for (const directory of packageDirectories(files)) {
    const bin = join(root, directory, "node_modules", ".bin");
    const entries = await fg("*", {
      cwd: bin,
      dot: true,
      followSymbolicLinks: false,
      onlyFiles: false,
      unique: true,
    }).catch(() => []);
    for (const name of entries) {
      const key = directory === "." ? name : `${directory}:${name}`;
      result[key] = await executablePresent(join(bin, name));
    }
  }
  return result;
}

async function anyExecutablePresent(bins: string[], name: string) {
  for (const bin of bins)
    if (await executablePresent(join(bin, name))) return true;
  return false;
}

async function declaredExecutables(
  root: string,
  files: string[],
  packages: Set<string>,
) {
  const executables = new Set<string>();
  for (const packageName of packages)
    (await packageExecutables(root, files, packageName)).forEach((name) =>
      executables.add(name),
    );
  return executables;
}

async function packageExecutables(
  root: string,
  files: string[],
  packageName: string,
) {
  for (const directory of packageDirectories(files)) {
    try {
      const manifest = JSON.parse(
        await readFile(
          join(root, directory, "node_modules", packageName, "package.json"),
          "utf8",
        ),
      ) as { bin?: string | Record<string, string> };
      if (typeof manifest.bin === "string")
        return [packageName.split("/").at(-1)!];
      if (manifest.bin) return Object.keys(manifest.bin);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
  }
  return [];
}

async function executablePresent(path: string) {
  try {
    await access(path);
    const info = await lstat(path);
    if (info.isSymbolicLink()) await realpath(path);
    return true;
  } catch {
    return false;
  }
}

async function symlinkTargetsPresent(root: string) {
  const links = await fg("**/node_modules/{.bin,.pnpm}/**/*", {
    cwd: root,
    dot: true,
    followSymbolicLinks: false,
    onlyFiles: false,
    unique: true,
  });
  for (const path of links.slice(0, 10_000)) {
    const absolute = join(root, path);
    if (!(await lstat(absolute)).isSymbolicLink()) continue;
    try {
      await realpath(absolute);
    } catch {
      return false;
    }
  }
  return true;
}

async function dependencyStorePresent(root: string) {
  const candidates = [
    "node_modules/.pnpm",
    "node_modules/.package-lock.json",
    "node_modules/.yarn-state.yml",
    "node_modules/.cache",
    "node_modules/.blame-environment",
  ];
  for (const candidate of candidates) {
    try {
      await lstat(join(root, candidate));
      return true;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
  }
  return false;
}

function packageDirectories(files: string[]) {
  const directories = new Set<string>(["."]);
  files
    .filter(isPackageManifest)
    .forEach((path) => directories.add(dirname(path)));
  return [...directories].sort();
}

function isPackageManifest(path: string) {
  return basename(path) === "package.json";
}

function isDependencyMetadata(path: string) {
  return /(^|\/)(?:package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|pnpm-workspace\.yaml)$/u.test(
    path,
  );
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
