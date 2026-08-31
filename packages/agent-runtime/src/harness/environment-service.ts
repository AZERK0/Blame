import { basename } from "node:path";
import { sha256 } from "./protocol.js";
import type { WorkspaceFiles } from "./workspace-files.js";
import type { WorkspaceSnapshot } from "./workspace-files.js";

const environmentInputs = new Set([
  "bun.lock",
  "bun.lockb",
  "deno.json",
  "deno.lock",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "pyproject.toml",
  "requirements.txt",
  "tsconfig.json",
  "yarn.lock",
]);

export type EnvironmentSpecContext = {
  buildEnvironment?: Record<string, string>;
  dependencyVolumeDigest?: string;
  executionProfile?: string;
  packageManager?: string;
  resolvedPackageManagerVersion?: string;
  runtimeTarget?: string;
};

export type EnvironmentSpec = {
  environment_revision_id: string;
  environment_spec_revision_id: string;
  fingerprint: string;
  profile: string;
  dependency_digest: string;
  dependency_volume_digest: string;
  package_manager: string;
  resolved_package_manager_version: string;
  runtime_target: string;
  build_environment_digest: string;
  runtime: {
    node: string;
    platform: NodeJS.Platform;
    architecture: string;
  };
  inputs: Array<{ path: string; sha256: string }>;
};

export async function environmentSpec(
  files: WorkspaceFiles,
  snapshot: WorkspaceSnapshot,
  context: EnvironmentSpecContext = {},
): Promise<EnvironmentSpec> {
  const inputs: Array<{ path: string; sha256: string }> = [];
  for (const path of snapshot.files) {
    if (!environmentInputs.has(basename(path))) continue;
    try {
      inputs.push({ path, sha256: await files.blobHash(path) });
    } catch {}
  }
  inputs.sort((left, right) => left.path.localeCompare(right.path));
  const runtime = {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
  };
  const dependencyDigest = sha256(JSON.stringify(inputs));
  const buildEnvironmentDigest = sha256(
    JSON.stringify(sortedRecord(context.buildEnvironment ?? {})),
  );
  const profile = context.executionProfile ?? "default";
  const packageManager = context.packageManager ?? "unknown";
  const resolvedPackageManagerVersion =
    context.resolvedPackageManagerVersion ?? "unresolved";
  const runtimeTarget = context.runtimeTarget ?? localRuntimeTarget();
  const dependencyVolumeDigest =
    context.dependencyVolumeDigest ?? dependencyDigest;
  const fingerprint = sha256(
    JSON.stringify({
      buildEnvironmentDigest,
      dependencyDigest,
      dependencyVolumeDigest,
      packageManager,
      profile,
      resolvedPackageManagerVersion,
      runtime,
      runtimeTarget,
      inputs,
    }),
  );
  const environmentRevisionId = `env_${fingerprint.slice(0, 32)}`;
  return {
    environment_revision_id: environmentRevisionId,
    environment_spec_revision_id: environmentRevisionId,
    fingerprint,
    profile,
    dependency_digest: dependencyDigest,
    dependency_volume_digest: dependencyVolumeDigest,
    package_manager: packageManager,
    resolved_package_manager_version: resolvedPackageManagerVersion,
    runtime_target: runtimeTarget,
    build_environment_digest: buildEnvironmentDigest,
    runtime,
    inputs,
  };
}

function localRuntimeTarget() {
  if (process.platform === "darwin") return "lima";
  if (process.platform === "win32") return "wsl";
  return "linux-native";
}

function sortedRecord(value: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}
