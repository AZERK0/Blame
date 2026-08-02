import assert from "node:assert/strict"
import test from "node:test"
import { WorkspaceWriterRegistry } from "./workspace-writer-registry.ts"

test("tracks one local writer across session binding and completion", () => {
  const registry = new WorkspaceWriterRegistry()
  registry.begin("pending", "/work/story")
  assert.equal(registry.hasActiveWriter("/work/story"), true)

  registry.rebind("pending", "session-a")
  assert.equal(registry.workspaceForSession("session-a"), "/work/story")
  assert.equal(registry.hasActiveWriter("/work/story"), true)

  registry.end("session-a")
  assert.equal(registry.hasActiveWriter("/work/story"), false)
  assert.equal(registry.workspaceForSession("session-a"), "/work/story")
})

test("releasing a workspace removes active and resumable session ownership", () => {
  const registry = new WorkspaceWriterRegistry()
  registry.begin("session-a", "/work/story")
  registry.releaseWorkspace("/work/story/.")
  assert.equal(registry.hasActiveWriter("/work/story"), false)
  assert.equal(registry.workspaceForSession("session-a"), undefined)
})
