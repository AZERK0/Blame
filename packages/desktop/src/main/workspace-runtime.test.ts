import assert from "node:assert/strict";
import test from "node:test";
import {
  runtimeCommand,
  runtimeManagedPath,
  storyBranch,
  worktreePath,
  worktreeRoot,
} from "./workspace-runtime.ts";

test("uses the shared runtime worktree root", () => {
  assert.equal(
    worktreeRoot("win32"),
    "/home/blame/.local/share/blame/runtime/worktrees",
  );
  assert.equal(
    worktreeRoot("linux", { HOME: "/home/dev" }),
    "/home/dev/.local/share/blame/runtime/worktrees",
  );
});

test("builds stable worktree paths for every desktop platform", () => {
  const expectedRuntime =
    "/home/blame/.local/share/blame/runtime/worktrees/Blame/story-42-add-login";

  assert.equal(
    worktreePath({
      env: { HOME: "/home/dev" },
      platform: "linux",
      repositoryRoot: "/mnt/dev/web/Blame",
      storyId: 42,
      title: "Add login",
    }),
    "/home/dev/.local/share/blame/runtime/worktrees/Blame/story-42-add-login",
  );
  assert.equal(
    worktreePath({
      platform: "darwin",
      repositoryRoot: "/Users/blame/Blame",
      storyId: 42,
      title: "Add login",
    }),
    expectedRuntime,
  );
  assert.equal(
    worktreePath({
      platform: "win32",
      repositoryRoot: String.raw`C:\Users\blame\Blame`,
      storyId: 42,
      title: "Add login",
    }),
    expectedRuntime,
  );
});

test("keeps story branch naming unchanged", () => {
  assert.equal(storyBranch(42, "Add login"), "blame/story-42-add-login");
});

test("routes commands through the platform runtime", () => {
  assert.deepEqual(runtimeCommand("git", ["status"], { platform: "linux" }), {
    args: ["status"],
    command: "git",
    cwd: undefined,
  });
  assert.deepEqual(runtimeCommand("git", ["status"], { platform: "darwin" }), {
    args: ["git", "status"],
    command: "blame-lima-runtime",
  });
  assert.deepEqual(runtimeCommand("git", ["status"], { platform: "win32" }), {
    args: ["git", "status"],
    command: "blame-wsl2-runtime",
  });
});

test("runs runtime cwd commands inside WSL2 or Lima", () => {
  assert.deepEqual(
    runtimeCommand("git", ["status"], {
      cwd: "/home/blame/project",
      platform: "win32",
    }),
    {
      args: ["sh", "-lc", "cd '/home/blame/project' && exec 'git' 'status'"],
      command: "blame-wsl2-runtime",
    },
  );
});

test("detects runtime-managed paths only on Windows and macOS", () => {
  const path = "/home/blame/.local/share/blame/runtime/worktrees/repo/story";

  assert.equal(runtimeManagedPath(path, "linux"), false);
  assert.equal(runtimeManagedPath(path, "darwin"), true);
  assert.equal(runtimeManagedPath(path, "win32"), true);
});
