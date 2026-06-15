import assert from "node:assert/strict"
import test from "node:test"
import {
  localWorkspaceInput,
  resolveAgentWorkspaceInput,
} from "./cline-backend-resolver.ts"

test("resolves Windows runtime worktrees to a remote Cline backend", async () => {
  const input = {
    cwd: "/home/blame/.local/share/blame/runtime/worktrees/repo/story",
    workspaceRoot: "/home/blame/.local/share/blame/runtime/worktrees/repo/story",
  }

  const resolved = await resolveAgentWorkspaceInput(input, {
    agentClient: {
      clineHubEnsure: async () => ({
        authToken: "secret",
        url: "ws://127.0.0.1:25463/hub",
      }),
    },
    ensureReady: async () => ({
      issues: [],
      platform: "win32",
      runtime: "BlameRuntime",
      status: "ready",
    }),
    platform: "win32",
  })

  assert.equal(resolved.cwd, input.cwd)
  assert.equal(resolved.workspaceRoot, input.workspaceRoot)
  assert.deepEqual(resolved.backend, {
    authToken: "secret",
    cwd: input.cwd,
    endpoint: "ws://127.0.0.1:25463/hub",
    key: "runtime:win32:ws://127.0.0.1:25463/hub",
    mode: "remote",
    workspaceRoot: input.workspaceRoot,
  })
})

test("resolves macOS runtime worktrees to a remote Cline backend", async () => {
  const cwd =
    "/Users/dev/Library/Application Support/Blame/runtime/worktrees/repo/story"

  const resolved = await resolveAgentWorkspaceInput(
    { cwd, workspaceRoot: cwd },
    {
      agentClient: {
        clineHubEnsure: async () => ({ url: "ws://127.0.0.1:25463/hub" }),
      },
      ensureReady: async () => ({
        issues: [],
        platform: "darwin",
        runtime: "BlameRuntime",
        status: "ready",
      }),
      platform: "darwin",
    },
  )

  assert.equal(resolved.cwd, cwd)
  assert.equal(resolved.backend.mode, "remote")
})

test("resolves Linux and unmanaged paths to local Cline backend", async () => {
  const input = { cwd: "/home/dev/project", workspaceRoot: "/home/dev/project" }

  assert.deepEqual(await resolveAgentWorkspaceInput(input, { platform: "linux" }), {
    ...input,
    backend: { mode: "local", key: "local" },
  })
  assert.deepEqual(localWorkspaceInput(input, "win32"), {
    ...input,
    backend: { mode: "local", key: "local" },
  })
})
