import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import type { TaskCatalogItem } from "./schemas.js";

const dependencyFiles =
  /(^|\/)(?:package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|pnpm-workspace\.yaml)$/u;
const manifestName = "dependency-cache-manifest.json";

export type DependencyIntegrityProbe = {
  status: "passed" | "failed";
  cwd: string;
  executables: Record<string, boolean>;
  packages: Record<string, boolean>;
  symlink_targets_present: boolean;
  store_present: boolean;
  checked_at: string;
  failure_signature?: string;
};

export type DependencyCacheManifest = {
  schema_version: "1.0";
  dependency_digest: string;
  package_manager: string;
  resolved_version: string;
  platform: NodeJS.Platform;
  architecture: string;
  runtime_target: string;
  created_at: string;
  integrity_probe: DependencyIntegrityProbe;
};

export async function dependencyCacheRoot(
  workspaceRoot: string,
  files: string[],
  task: TaskCatalogItem,
) {
  const digest = await dependencyDigest(workspaceRoot, files, task);
  const root = join(
    workspaceRoot,
    ".blame",
    "harness",
    "dependency-cache",
    task.package_manager,
    digest,
  );
  await mkdir(root, { recursive: true, mode: 0o700 });
  return root;
}

export async function dependencyCachePopulated(root: string) {
  const manifest = await readDependencyCacheManifest(root);
  return manifest?.integrity_probe.status === "passed";
}

export async function readDependencyCacheManifest(root: string) {
  try {
    const value = JSON.parse(
      await readFile(join(root, manifestName), "utf8"),
    ) as unknown;
    return validManifest(value) ? value : undefined;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

export async function writeDependencyCacheManifest(
  root: string,
  manifest: DependencyCacheManifest,
) {
  if (!validManifest(manifest))
    throw new Error("INVALID_DEPENDENCY_CACHE_MANIFEST");
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeFileAtomic(join(root, manifestName), JSON.stringify(manifest), {
    fsync: true,
    mode: 0o600,
  });
}

export async function dependencyDigest(
  workspaceRoot: string,
  files: string[],
  task: TaskCatalogItem,
) {
  const digest = createHash("sha256");
  digest.update(
    `${task.package_manager}@${task.package_manager_version ?? "default"}\0`,
  );
  const relevant = files.filter((path) => dependencyFiles.test(path)).sort();
  for (const path of relevant) {
    digest.update(path);
    digest.update("\0");
    digest.update(await readFile(join(workspaceRoot, path)));
    digest.update("\0");
  }
  return digest.digest("hex");
}

function validManifest(value: unknown): value is DependencyCacheManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const manifest = value as Record<string, unknown>;
  const probe = manifest.integrity_probe;
  return (
    manifest.schema_version === "1.0" &&
    nonEmptyString(manifest.dependency_digest) &&
    nonEmptyString(manifest.package_manager) &&
    nonEmptyString(manifest.resolved_version) &&
    nonEmptyString(manifest.platform) &&
    nonEmptyString(manifest.architecture) &&
    nonEmptyString(manifest.runtime_target) &&
    nonEmptyString(manifest.created_at) &&
    validProbe(probe)
  );
}

function validProbe(value: unknown): value is DependencyIntegrityProbe {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const probe = value as Record<string, unknown>;
  return (
    ["passed", "failed"].includes(String(probe.status)) &&
    nonEmptyString(probe.cwd) &&
    recordOfBooleans(probe.executables) &&
    recordOfBooleans(probe.packages) &&
    typeof probe.symlink_targets_present === "boolean" &&
    typeof probe.store_present === "boolean" &&
    nonEmptyString(probe.checked_at)
  );
}

function recordOfBooleans(value: unknown) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every(
      (entry) => typeof entry === "boolean",
    )
  );
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
