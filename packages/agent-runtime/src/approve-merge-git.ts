import { randomUUID } from "node:crypto";

export type TargetChangesStash = {
  commit: string;
};

type GitRunner = (cwd: string, args: string[]) => Promise<string>;

export async function stashTargetChanges(
  cwd: string,
  git: GitRunner,
): Promise<TargetChangesStash | undefined> {
  const previous = await optionalGitRevision(cwd, "refs/stash", git);
  await git(cwd, [
    "stash",
    "push",
    "--include-untracked",
    "--message",
    `blame-approve-merge-${randomUUID()}`,
  ]);
  const commit = await optionalGitRevision(cwd, "refs/stash", git);
  return commit && commit !== previous ? { commit } : undefined;
}

export async function assertTargetChangesRestorable(
  cwd: string,
  stash: TargetChangesStash | undefined,
  git: GitRunner,
) {
  if (!stash) return;
  try {
    await git(cwd, ["stash", "apply", "--index", stash.commit]);
  } catch (error) {
    throw new Error(
      `The story changes conflict with local target-branch changes. The merge was stopped before advancing the target branch. ${errorMessage(error)}`,
    );
  } finally {
    await git(cwd, ["reset", "--hard", "HEAD"]);
    await git(cwd, ["clean", "-d", "-f"]);
  }
}

export async function restoreTargetChanges(
  cwd: string,
  stash: TargetChangesStash,
  git: GitRunner,
) {
  try {
    await git(cwd, ["stash", "apply", "--index", stash.commit]);
  } catch (error) {
    throw new Error(
      `Git could not restore the local target-branch changes automatically. They remain saved in the stash (${stash.commit}). ${errorMessage(error)}`,
    );
  }
  const reference = await gitStashReference(cwd, stash.commit, git);
  if (!reference) return {};
  try {
    await git(cwd, ["stash", "drop", reference]);
    return {};
  } catch (cleanupError) {
    return { cleanupError };
  }
}

async function optionalGitRevision(
  cwd: string,
  revision: string,
  git: GitRunner,
) {
  try {
    return await git(cwd, ["rev-parse", "--verify", revision]);
  } catch {
    return undefined;
  }
}

async function gitStashReference(cwd: string, commit: string, git: GitRunner) {
  const entries = await git(cwd, ["stash", "list", "--format=%gd%x00%H"]);
  for (const entry of entries.split("\n")) {
    const [reference, hash] = entry.split("\0");
    if (reference && hash === commit) return reference;
  }
  return undefined;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
