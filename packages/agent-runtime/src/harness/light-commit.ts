import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { lock } from "proper-lockfile";
import writeFileAtomic from "write-file-atomic";
import { sha256 } from "./light-identity.js";
import type { WorkspaceFiles } from "./workspace-files.js";

export type LightFileMutation = {
  after: Buffer | null;
  before: Buffer | null;
  mode?: number;
  path: string;
};

export type LightCommitResult = {
  changedPaths: string[];
  sourceRevisionId: string;
};

export class LightCommitConflict extends Error {}

export class LightCommitService {
  private readonly files: WorkspaceFiles;
  private readonly lockDirectory: string;

  constructor(files: WorkspaceFiles) {
    this.files = files;
    this.lockDirectory = join(files.root, ".blame", "harness", "light-write");
  }

  async commit(mutations: LightFileMutation[], expectedRevision: string) {
    return this.exclusive(() => this.commitLocked(mutations, expectedRevision));
  }

  async exclusive<T>(operation: () => Promise<T>) {
    await mkdir(this.lockDirectory, { recursive: true, mode: 0o700 });
    const release = await lock(this.lockDirectory, lockOptions);
    try {
      return await operation();
    } finally {
      await release();
    }
  }

  async restoreFiles(mutations: LightFileMutation[]) {
    for (const mutation of [...mutations].reverse())
      await writeMutation(this.files, mutation, "before");
  }

  private async commitLocked(
    mutations: LightFileMutation[],
    expectedRevision: string,
  ): Promise<LightCommitResult> {
    await this.assertRevision(expectedRevision);
    const changed = mutations.filter(mutationChangesContent);
    await Promise.all(changed.map((mutation) => this.verifyMutation(mutation)));
    await this.applyAll(changed);
    const snapshot = await this.files.snapshot();
    return {
      changedPaths: changed.map(({ path }) => path),
      sourceRevisionId: snapshot.revision.source_revision_id,
    };
  }

  private async assertRevision(expectedRevision: string) {
    const current = await this.files.snapshot();
    if (current.revision.source_revision_id !== expectedRevision)
      throw new LightCommitConflict(
        "The worktree changed while the edit batch was being prepared.",
      );
  }

  private async verifyMutation(mutation: LightFileMutation) {
    const path = this.files.normalizePath(mutation.path);
    if (path !== mutation.path)
      throw new LightCommitConflict(`Edit path is not canonical: ${path}.`);
    await this.files.resolveForWriteVerified(path);
    const current = await optionalContent(this.files, path);
    if (contentHash(current) !== contentHash(mutation.before))
      throw new LightCommitConflict(`File changed before commit: ${path}.`);
  }

  private async applyAll(mutations: LightFileMutation[]) {
    const applied: LightFileMutation[] = [];
    try {
      for (const mutation of mutations) {
        applied.push(mutation);
        await writeMutation(this.files, mutation, "after");
      }
    } catch (error) {
      await rollbackAll(this.files, applied, error);
    }
  }
}

const lockOptions = {
  realpath: false,
  retries: { retries: 40, factor: 1.2, minTimeout: 25, maxTimeout: 1_000 },
  stale: 60_000,
  update: 10_000,
};

async function rollbackAll(
  files: WorkspaceFiles,
  applied: LightFileMutation[],
  cause: unknown,
): Promise<never> {
  const failures: unknown[] = [];
  for (const mutation of [...applied].reverse())
    await writeMutation(files, mutation, "before").catch((error) =>
      failures.push(error),
    );
  if (failures.length)
    throw new AggregateError([cause, ...failures], "Edit rollback failed.");
  throw cause;
}

async function writeMutation(
  files: WorkspaceFiles,
  mutation: LightFileMutation,
  field: "after" | "before",
) {
  const { absolute } = await files.resolveForWriteVerified(mutation.path);
  const content = mutation[field];
  if (content === null) return rm(absolute, { force: true });
  await mkdir(dirname(absolute), { recursive: true });
  await writeFileAtomic(absolute, content, {
    fsync: true,
    mode: mutation.mode ?? 0o644,
  });
}

async function optionalContent(files: WorkspaceFiles, path: string) {
  try {
    return (await files.read(path)).content;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

function mutationChangesContent(mutation: LightFileMutation) {
  return contentHash(mutation.before) !== contentHash(mutation.after);
}

function contentHash(content: Buffer | null) {
  return content ? sha256(content) : null;
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
