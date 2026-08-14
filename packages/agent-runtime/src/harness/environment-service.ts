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

export type EnvironmentSpec = {
  environment_spec_revision_id: string;
  fingerprint: string;
  profile: "default";
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
): Promise<EnvironmentSpec> {
  const inputs: Array<{ path: string; sha256: string }> = [];
  for (const path of snapshot.files) {
    if (!environmentInputs.has(basename(path))) continue;
    try {
      inputs.push({ path, sha256: await files.blobHash(path) });
    } catch {
      // Exact source handles reject symlinks and special files. Such entries
      // remain represented by the source revision, but are not toolchain specs.
    }
  }
  inputs.sort((left, right) => left.path.localeCompare(right.path));
  const runtime = {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
  };
  const fingerprint = sha256(
    JSON.stringify({
      runtime,
      inputs,
      profile: "default",
    }),
  );
  return {
    environment_spec_revision_id: `env_${fingerprint.slice(0, 32)}`,
    fingerprint,
    profile: "default",
    runtime,
    inputs,
  };
}
