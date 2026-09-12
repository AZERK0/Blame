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

test("merges a VM story through host credentials and preserves unpublished target commits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "blame-approve-host-"));
  const repositoryRoot = join(directory, "project");
  const worktree = join(directory, "vm-story");
  const remote = join(directory, "remote.git");
  const fetches: string[] = [];
  try {
    await mkdir(repositoryRoot);
    await git(directory, ["init", "--bare", remote]);
    await git(repositoryRoot, ["init", "--initial-branch=main"]);
    await git(repositoryRoot, ["config", "user.email", "blame@example.com"]);
    await git(repositoryRoot, ["config", "user.name", "Blame Test"]);
    await writeFile(join(repositoryRoot, "base.txt"), "base\n");
    await git(repositoryRoot, ["add", "."]);
    await git(repositoryRoot, ["commit", "-m", "initial"]);
    await git(repositoryRoot, ["remote", "add", "origin", remote]);
    await git(repositoryRoot, ["push", "--set-upstream", "origin", "main"]);
    await git(repositoryRoot, [
      "worktree",
      "add",
      "-b",
      "story/retry",
      worktree,
    ]);
    await writeFile(join(worktree, "story.txt"), "approved story\n");
    await git(worktree, ["add", "."]);
    await git(worktree, [
      "commit",
      "-m",
      "story already committed before retry",
    ]);
    await writeFile(
      join(repositoryRoot, "local.txt"),
      "unpublished target work\n",
    );
    await git(repositoryRoot, ["add", "."]);
    await git(repositoryRoot, ["commit", "-m", "local target commit"]);
    const baseCommit = await git(repositoryRoot, ["rev-parse", "HEAD"]);
    const runtime = new BlameAgentRuntime(undefined, {
      git: async (cwd, args) => {
        if (args[0] === "fetch" || args[0] === "push") {
          assert.equal(
            cwd,
            repositoryRoot,
            "remote credentials exist only on the host",
          );
          if (args[0] === "fetch") fetches.push(cwd);
        }
        return git(cwd, args);
      },
    });
    const result = await runtime.approveAndMerge({
      apiConnection: { url: "https://api.example" },
      modelId: "test-model",
      providerId: "test-provider",
      repositoryRoot,
      worktree,
      storyBranch: "story/retry",
      title: "Resume a committed VM story",
      summary: "Finish approval without giving the VM remote credentials.",
    });
    assert.equal(result.baseCommit, baseCommit);
    assert.equal(result.targetBranch, "main");
    assert.equal(
      await git(repositoryRoot, ["rev-parse", "HEAD"]),
      result.mergeCommit,
    );
    assert.equal(await git(remote, ["rev-parse", "main"]), result.mergeCommit);
    assert.equal(
      await readFile(join(repositoryRoot, "local.txt"), "utf8"),
      "unpublished target work\n",
    );
    assert.equal(
      await readFile(join(repositoryRoot, "story.txt"), "utf8"),
      "approved story\n",
    );
    assert.deepEqual(fetches, [repositoryRoot]);
  } finally {
    new BlameAgentRuntime(undefined, { git });
    await rm(directory, { recursive: true, force: true });
  }
});

async function git(cwd: string, args: string[]) {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}
