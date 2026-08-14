import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import writeFileAtomic from "write-file-atomic";
import type { ArtifactStore } from "./artifact-store.js";
import { sha256 } from "./protocol.js";
import type { ProposedFile, StoredChangeProposal } from "./schemas.js";
import {
  assertMutableWorkspacePath,
  type WorkspaceFiles,
} from "./workspace-files.js";

export async function verifyProposalBase(
  files: WorkspaceFiles,
  proposal: StoredChangeProposal,
) {
  for (const change of proposal.changes) {
    let digest: string | null;
    try {
      digest = sha256((await files.read(change.path)).content);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
      digest = null;
    }
    if (digest !== change.old_hash)
      throw new Error(`File precondition failed for ${change.path}.`);
  }
}

export async function validateProposalWriteTargets(
  files: WorkspaceFiles,
  artifacts: ArtifactStore,
  proposal: StoredChangeProposal,
) {
  for (const change of proposal.changes) {
    const path = checkedPath(files, change.path);
    if (path !== change.path)
      throw new Error(`Proposal path is not canonical: ${change.path}.`);
    await files.resolveForWriteVerified(path);
    if (change.old_artifact !== null) {
      const bytes = await artifacts.get(change.old_artifact.ref);
      if (sha256(bytes) !== change.old_hash)
        throw new Error(`Stored old content hash mismatch for ${path}.`);
    } else if (change.old_hash !== null) {
      throw new Error(`Stored old content metadata mismatch for ${path}.`);
    }
    if (change.new_artifact !== null) {
      const bytes = await artifacts.get(change.new_artifact.ref);
      if (sha256(bytes) !== change.new_hash)
        throw new Error(`Stored new content hash mismatch for ${path}.`);
    } else if (change.new_hash !== null) {
      throw new Error(`Stored new content metadata mismatch for ${path}.`);
    }
  }
}

export async function writeProposedFile(
  files: WorkspaceFiles,
  artifacts: ArtifactStore,
  change: ProposedFile,
  field: "new_artifact" | "old_artifact",
) {
  const path = checkedPath(files, change.path);
  const { absolute } = await files.resolveForWriteVerified(path);
  const artifact = change[field];
  if (artifact === null) {
    await rm(absolute, { force: true });
    return;
  }
  await mkdir(dirname(absolute), { recursive: true });
  const mode = field === "new_artifact" ? change.new_mode : change.old_mode;
  await writeFileAtomic(absolute, await artifacts.get(artifact.ref), {
    fsync: true,
    ...(mode === null ? {} : { mode }),
  });
}

export async function currentFileHash(files: WorkspaceFiles, path: string) {
  try {
    return sha256((await files.read(path)).content);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

function checkedPath(files: WorkspaceFiles, input: string) {
  const path = files.normalizePath(input);
  assertMutableWorkspacePath(path);
  return path;
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
