import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import test from "node:test"
import { buildWorkspaceArtifact } from "./workspace-artifact.ts"

const exec = promisify(execFile)

test("builds a reproducible source artifact without runtime secrets", async () => {
  const root = await mkdtemp(join(tmpdir(), "blame-source-test-"))
  try {
    await exec("git", ["init", root])
    await writeFile(join(root, "index.js"), "console.log('ok')\n")
    await exec("git", ["-C", root, "add", "index.js"])
    await exec("git", ["-C", root, "-c", "user.name=Blame Test", "-c", "user.email=test@blame.so", "commit", "-m", "base"])
    await writeFile(join(root, ".env"), "SECRET=never-upload\n")
    const first = await buildWorkspaceArtifact(root)
    const second = await buildWorkspaceArtifact(root)
    assert.equal(first.workspaceHash, second.workspaceHash)
    assert.equal(first.sourceRevision, second.sourceRevision)
    assert.equal(first.sha256, second.sha256)
    assert.ok(first.size > 0)
    assert.equal(first.content.includes(Buffer.from("SECRET=never-upload")), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
