import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { BlameAgentRuntime } from "./cline-runtime.js";

const execFileAsync = promisify(execFile);

test("merges into a dirty target branch and restores its local changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "blame-approve-merge-"));
  const repositoryRoot = join(directory, "repository");
  const worktree = join(directory, "story-worktree");

  try {
    await mkdir(repositoryRoot);
    await git(repositoryRoot, ["init", "--initial-branch=main"]);
    await git(repositoryRoot, ["config", "user.email", "blame@example.com"]);
    await git(repositoryRoot, ["config", "user.name", "Blame Test"]);
    await writeFile(
      join(repositoryRoot, "shared.txt"),
      "alpha\nbeta\ngamma\ndelta\nepsilon\n",
    );
    await writeFile(join(repositoryRoot, "unstaged.txt"), "base\n");
    await writeFile(join(repositoryRoot, "existing.txt"), "base\n");
    await git(repositoryRoot, ["add", "."]);
    await git(repositoryRoot, ["commit", "-m", "initial"]);
    const baseCommit = await git(repositoryRoot, ["rev-parse", "HEAD"]);

    await git(repositoryRoot, [
      "worktree",
      "add",
      "-b",
      "story/test-dirty-target",
      worktree,
      "main",
    ]);
    await writeFile(
      join(worktree, "shared.txt"),
      "alpha\nbeta\ngamma\ndelta\nstory epsilon\n",
    );
    await git(worktree, ["add", "shared.txt"]);
    await git(worktree, ["commit", "-m", "story change"]);
    const storyCommit = await git(worktree, ["rev-parse", "HEAD"]);

    await writeFile(join(repositoryRoot, "existing.txt"), "existing stash\n");
    await writeFile(join(repositoryRoot, "existing-untracked.txt"), "saved\n");
    await git(repositoryRoot, [
      "stash",
      "push",
      "--include-untracked",
      "--message",
      "pre-existing stash",
    ]);

    await writeFile(
      join(repositoryRoot, "shared.txt"),
      "local alpha\nbeta\ngamma\ndelta\nepsilon\n",
    );
    await git(repositoryRoot, ["add", "shared.txt"]);
    await writeFile(join(repositoryRoot, "unstaged.txt"), "local unstaged\n");
    await writeFile(join(repositoryRoot, "local-untracked.txt"), "local\n");

    const runtime = new BlameAgentRuntime();
    const result = await runtime.approveAndMerge({
      apiConnection: { url: "https://api.example" },
      modelId: "test-model",
      providerId: "test-provider",
      repositoryRoot,
      storyBranch: "story/test-dirty-target",
      summary: "Exercise merging with local target-branch changes.",
      title: "Dirty target merge",
      worktree,
    });

    assert.deepEqual(result, {
      baseCommit,
      mergeCommit: storyCommit,
      targetBranch: "main",
    });
    assert.equal(await git(repositoryRoot, ["rev-parse", "HEAD"]), storyCommit);
    assert.equal(
      await readFile(join(repositoryRoot, "shared.txt"), "utf8"),
      "local alpha\nbeta\ngamma\ndelta\nstory epsilon\n",
    );
    assert.equal(
      await readFile(join(repositoryRoot, "unstaged.txt"), "utf8"),
      "local unstaged\n",
    );
    assert.equal(
      await readFile(join(repositoryRoot, "local-untracked.txt"), "utf8"),
      "local\n",
    );
    assert.equal(
      await git(repositoryRoot, ["status", "--porcelain"]),
      ["M  shared.txt", " M unstaged.txt", "?? local-untracked.txt"].join("\n"),
    );
    assert.match(
      await git(repositoryRoot, ["stash", "list", "--format=%gs"]),
      /^On main: pre-existing stash$/,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("leaves the target branch unchanged when local changes truly conflict", async () => {
  const directory = await mkdtemp(join(tmpdir(), "blame-approve-conflict-"));
  const repositoryRoot = join(directory, "repository");
  const worktree = join(directory, "story-worktree");

  try {
    await mkdir(repositoryRoot);
    await git(repositoryRoot, ["init", "--initial-branch=main"]);
    await git(repositoryRoot, ["config", "user.email", "blame@example.com"]);
    await git(repositoryRoot, ["config", "user.name", "Blame Test"]);
    await writeFile(join(repositoryRoot, "shared.txt"), "base\n");
    await git(repositoryRoot, ["add", "."]);
    await git(repositoryRoot, ["commit", "-m", "initial"]);
    const baseCommit = await git(repositoryRoot, ["rev-parse", "HEAD"]);

    await git(repositoryRoot, [
      "worktree",
      "add",
      "-b",
      "story/test-conflicting-target",
      worktree,
      "main",
    ]);
    await writeFile(join(worktree, "shared.txt"), "story\n");
    await git(worktree, ["add", "shared.txt"]);
    await git(worktree, ["commit", "-m", "story change"]);
    await writeFile(join(repositoryRoot, "shared.txt"), "local\n");

    const runtime = new BlameAgentRuntime();
    await assert.rejects(
      runtime.approveAndMerge({
        apiConnection: { url: "https://api.example" },
        modelId: "test-model",
        providerId: "test-provider",
        repositoryRoot,
        storyBranch: "story/test-conflicting-target",
        summary: "Exercise a real local conflict.",
        title: "Conflicting target merge",
        worktree,
      }),
      /conflict with local target-branch changes/,
    );

    assert.equal(await git(repositoryRoot, ["rev-parse", "HEAD"]), baseCommit);
    assert.equal(
      await readFile(join(repositoryRoot, "shared.txt"), "utf8"),
      "local\n",
    );
    assert.equal(
      await git(repositoryRoot, ["status", "--porcelain"]),
      "M shared.txt",
    );
    assert.equal(
      await git(repositoryRoot, ["stash", "list", "--format=%gs"]),
      "",
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

async function git(cwd: string, args: string[]) {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}
