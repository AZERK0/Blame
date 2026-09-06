import type { SessionJournal } from "./session-journal.js";
import { sha256 } from "./light-identity.js";
import type { WorkspaceFiles, WorkspaceSnapshot } from "./workspace-files.js";

export async function observeCommand<T>(
  files: WorkspaceFiles,
  journal: SessionJournal,
  before: WorkspaceSnapshot,
  execute: () => Promise<T>,
) {
  const [execution] = await Promise.allSettled([execute()]);
  const after = await files.snapshot();
  const changedPaths = await recordCommandChanges(files, journal, before, after);
  if (execution.status === "rejected") throw execution.reason;
  return { after, changedPaths, result: execution.value };
}

async function recordCommandChanges(
  files: WorkspaceFiles,
  journal: SessionJournal,
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
) {
  if (before.revision.source_revision_id === after.revision.source_revision_id)
    return [];
  if (before.revision.base_commit !== after.revision.base_commit)
    throw new Error(
      "The repository HEAD changed during command execution; inspect the worktree before continuing.",
    );
  const alreadyRecorded = new Set(await journal.currentChangedPaths());
  const changes = (await changedFiles(files, before, after)).filter(
    ({ path }) => !alreadyRecorded.has(path),
  );
  if (!changes.length) return [];
  const paths = changes.map(({ path }) => path);
  await journal.recordChange({
    beforeFiles: changes,
    parse: "not_supported",
    paths,
    receipt: `command-${after.revision.source_revision_id}`,
    sourceRevisionId: after.revision.source_revision_id,
    symbols: [],
  });
  return paths;
}

async function changedFiles(
  files: WorkspaceFiles,
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
) {
  const oldStates = new Map(
    before.fileStates.map(({ path, hash }) => [path, hash]),
  );
  const newStates = new Map(
    after.fileStates.map(({ path, hash }) => [path, hash]),
  );
  const candidates = new Set([...oldStates.keys(), ...newStates.keys()]);
  const changes = [];
  for (const path of candidates) {
    if (oldStates.get(path) === newStates.get(path)) continue;
    const baseline =
      oldStates.has(path) && newStates.has(path)
        ? "absent"
        : await baselineHash(files, before, path);
    const hash = oldStates.get(path) ?? baseline;
    if (hash !== (newStates.get(path) ?? baseline))
      changes.push({ path, hash });
  }
  return changes;
}

async function baselineHash(
  files: WorkspaceFiles,
  snapshot: WorkspaceSnapshot,
  path: string,
) {
  if (!snapshot.git || !snapshot.revision.base_commit) return "absent";
  const file = await files.baseline(path);
  return file ? sha256(file.content) : "absent";
}
