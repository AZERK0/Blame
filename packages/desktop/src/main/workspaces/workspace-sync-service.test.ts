import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import test from "node:test"
import type { PreviewSessionView } from "@blame/preview-runtime"
import type { CloudPreviewClient } from "../preview-runtime/cloud-preview-client.ts"
import { WorkspaceSyncService } from "./workspace-sync-service.ts"

const execFileAsync = promisify(execFile)

test("skips upload and import when the persisted workspace hash is unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "blame-workspace-sync-"))
  try {
    await execFileAsync("git", ["-C", root, "init", "--quiet"])
    await execFileAsync("git", ["-C", root, "config", "user.name", "Blame"])
    await execFileAsync("git", ["-C", root, "config", "user.email", "preview@blame.local"])
    await writeFile(join(root, "package.json"), '{"name":"fixture"}\n')
    await execFileAsync("git", ["-C", root, "add", "package.json"])
    await execFileAsync("git", ["-C", root, "commit", "--quiet", "-m", "fixture"])

    const service = new WorkspaceSyncService()
    const metadata = await service.prepareInitial(root)
    const session = {
      id: "preview_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      sourceRevision: metadata.sourceRevision,
      workspaceHash: metadata.workspaceHash,
    } as PreviewSessionView
    let uploadPrepared = false
    const client = {
      async negotiateSource() {
        return { unchanged: true, session }
      },
      async prepareSourceUpload() {
        uploadPrepared = true
        throw new Error("upload should have been skipped")
      },
    } as unknown as CloudPreviewClient

    const result = await service.syncInitial(client, session.id, root)

    assert.equal(result.session, session)
    assert.equal(result.workspaceHash, metadata.workspaceHash)
    assert.equal(uploadPrepared, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
