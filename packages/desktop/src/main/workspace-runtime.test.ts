import assert from "node:assert/strict";
import test from "node:test";
import {
  runtimeCommand,
  runtimeAccessiblePath,
  runtimeHostPath,
  runtimeManagedPath,
  storyBranch,
  worktreePath,
  worktreeRoot,
  hasMissingWorkspaceNodeModules,
} from "./workspace-runtime.ts";

test("uses the shared runtime worktree root", () => {
  assert.equal(
    worktreeRoot("win32"),
    "/home/blame/.local/share/blame/runtime/worktrees",
  );
  assert.equal(
    worktreeRoot("darwin", { HOME: "/Users/dev" }),
    "/Users/dev/Library/Application Support/Blame/runtime/worktrees",
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
      env: { HOME: "/Users/blame" },
      platform: "darwin",
      repositoryRoot: "/Users/blame/Blame",
      storyId: 42,
      title: "Add login",
    }),
    "/Users/blame/Library/Application Support/Blame/runtime/worktrees/Blame/story-42-add-login",
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
  assert.deepEqual(
    runtimeCommand("git", ["status"], {
      cwd: String.raw`C:\Users\vanwa\Downloads\projet_test\raphtest`,
      platform: "win32",
    }),
    {
      args: [
        "sh",
        "-lc",
        "cd '/mnt/c/Users/vanwa/Downloads/projet_test/raphtest' && exec 'git' 'status'",
      ],
      command: "blame-wsl2-runtime",
    },
  );
});

test("routes root runtime commands through WSL2 or Lima", () => {
  assert.deepEqual(
    runtimeCommand("rm", ["-rf", "/home/blame/project"], {
      platform: "win32",
      user: "root",
    }),
    {
      args: ["root", "rm", "-rf", "/home/blame/project"],
      command: "blame-wsl2-runtime",
    },
  );
  assert.deepEqual(
    runtimeCommand("rm", ["-rf", "/home/blame/project"], {
      cwd: "/home/blame",
      platform: "darwin",
      user: "root",
    }),
    {
      args: [
        "root",
        "sh",
        "-lc",
        "cd '/home/blame' && exec 'rm' '-rf' '/home/blame/project'",
      ],
      command: "blame-lima-runtime",
    },
  );
});

test("converts Windows host paths to WSL paths for runtime access", () => {
  assert.equal(
    runtimeAccessiblePath(
      String.raw`C:\Users\vanwa\Downloads\projet_test\raphtest`,
      "win32",
    ),
    "/mnt/c/Users/vanwa/Downloads/projet_test/raphtest",
  );
  assert.equal(
    runtimeAccessiblePath(
      "/home/blame/.local/share/blame/runtime/worktrees/Test",
      "win32",
    ),
    "/home/blame/.local/share/blame/runtime/worktrees/Test",
  );
});

test("converts WSL runtime paths to host UNC paths for Windows agents", () => {
  assert.equal(
    runtimeHostPath(
      "/home/blame/.local/share/blame/runtime/worktrees/Test/story",
      "win32",
    ),
    String.raw`\\wsl.localhost\BlameRuntime\home\blame\.local\share\blame\runtime\worktrees\Test\story`,
  );
  assert.equal(
    runtimeHostPath("/home/dev/project", "win32"),
    "/home/dev/project",
  );
});

test("keeps macOS managed worktree paths accessible to local agents", () => {
  const path =
    "/Users/dev/Library/Application Support/Blame/runtime/worktrees/Test/story";

  assert.equal(runtimeHostPath(path, "darwin"), path);
  assert.equal(runtimeAccessiblePath(path, "darwin"), path);
});

test("detects runtime-managed paths only on Windows and macOS", () => {
  const path = "/home/blame/.local/share/blame/runtime/worktrees/repo/story";

  assert.equal(runtimeManagedPath(path, "linux"), false);
  assert.equal(runtimeManagedPath(path, "darwin"), true);
  assert.equal(runtimeManagedPath(path, "win32"), true);
  assert.equal(
    runtimeManagedPath(
      "/Users/dev/Library/Application Support/Blame/runtime/worktrees/repo/story",
      "darwin",
    ),
    true,
  );
});

test("hasMissingWorkspaceNodeModules: returns false for single-package root projects", async () => {
  const mockFns = {
    run: async () => ({
      stdout: "/workspace/package.json\n",
      stderr: "",
    }),
    readFile: async () => JSON.stringify({ dependencies: { foo: "1.0.0" } }),
    pathExists: async () => false,
    dirnameWorkspacePath: (p: string) => "/workspace",
    joinWorkspacePath: (dir: string, ...parts: string[]) => [dir, ...parts].join("/"),
  };

  const result = await hasMissingWorkspaceNodeModules("/workspace", mockFns);
  assert.equal(result, false);
});

test("hasMissingWorkspaceNodeModules: returns false for sub-packages with no dependencies", async () => {
  const mockFns = {
    run: async () => ({
      stdout: "/workspace/package.json\n/workspace/apps/web/package.json\n",
      stderr: "",
    }),
    readFile: async (p: string) => {
      if (p === "/workspace/apps/web/package.json") {
        return JSON.stringify({});
      }
      return JSON.stringify({ dependencies: { foo: "1.0.0" } });
    },
    pathExists: async () => false,
    dirnameWorkspacePath: (p: string) => {
      if (p.includes("apps/web")) return "/workspace/apps/web";
      return "/workspace";
    },
    joinWorkspacePath: (dir: string, ...parts: string[]) => [dir, ...parts].join("/"),
  };

  const result = await hasMissingWorkspaceNodeModules("/workspace", mockFns);
  assert.equal(result, false);
});

test("hasMissingWorkspaceNodeModules: returns false when sub-package node_modules exist", async () => {
  const mockFns = {
    run: async () => ({
      stdout: "/workspace/package.json\n/workspace/apps/web/package.json\n",
      stderr: "",
    }),
    readFile: async (p: string) => {
      if (p === "/workspace/apps/web/package.json") {
        return JSON.stringify({ dependencies: { next: "latest" } });
      }
      return JSON.stringify({});
    },
    pathExists: async (p: string) => {
      if (p === "/workspace/apps/web/node_modules") return true;
      return false;
    },
    dirnameWorkspacePath: (p: string) => {
      if (p.includes("apps/web")) return "/workspace/apps/web";
      return "/workspace";
    },
    joinWorkspacePath: (dir: string, ...parts: string[]) => [dir, ...parts].join("/"),
  };

  const result = await hasMissingWorkspaceNodeModules("/workspace", mockFns);
  assert.equal(result, false);
});

test("hasMissingWorkspaceNodeModules: returns true when sub-package node_modules are missing", async () => {
  const mockFns = {
    run: async () => ({
      stdout: "/workspace/package.json\n/workspace/apps/web/package.json\n",
      stderr: "",
    }),
    readFile: async (p: string) => {
      if (p === "/workspace/apps/web/package.json") {
        return JSON.stringify({ devDependencies: { next: "latest" } });
      }
      return JSON.stringify({});
    },
    pathExists: async (p: string) => {
      return false;
    },
    dirnameWorkspacePath: (p: string) => {
      if (p.includes("apps/web")) return "/workspace/apps/web";
      return "/workspace";
    },
    joinWorkspacePath: (dir: string, ...parts: string[]) => [dir, ...parts].join("/"),
  };

  const result = await hasMissingWorkspaceNodeModules("/workspace", mockFns);
  assert.equal(result, true);
});

