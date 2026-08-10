import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import test from "node:test"
import type { PreviewSessionView } from "@blame/preview-runtime"
import { CloudPreviewRequestError, type CloudPreviewClient } from "../preview-runtime/cloud-preview-client.ts"
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
      state: {
        host: "running",
        engine: "idle",
        preview: "closed",
        agent: "idle",
        sync: "clean",
      },
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

test("renegotiates a full upload when an exact baseline expires during sync", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "blame-workspace-sync-"))
  try {
    await execFileAsync("git", ["-C", root, "init", "--quiet"])
    await execFileAsync("git", ["-C", root, "config", "user.name", "Blame"])
    await execFileAsync("git", ["-C", root, "config", "user.email", "preview@blame.local"])
    await writeFile(join(root, "package.json"), '{"name":"fixture"}\n')
    await execFileAsync("git", ["-C", root, "add", "package.json"])
    await execFileAsync("git", ["-C", root, "commit", "--quiet", "-m", "fixture"])
    context.mock.method(globalThis, "fetch", async () => new Response(null, { status: 200 }))

    const service = new WorkspaceSyncService()
    await service.prepareInitial(root)
    const session = {
      id: "preview_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      state: {
        host: "running",
        engine: "idle",
        preview: "closed",
        agent: "idle",
        sync: "clean",
      },
    } as PreviewSessionView
    let negotiations = 0
    let applications = 0
    const uploadModes: Array<"full" | "delta" | undefined> = []
    const commands: string[] = []
    const client = {
      async negotiateSource() {
        negotiations += 1
        return {
          unchanged: false,
          session,
          baseline: negotiations === 1 ? { id: "baseline-expired", match: "exact" as const } : undefined,
        }
      },
      async prepareSourceUpload(_sessionId: string, artifact: { mode?: "full" | "delta" }) {
        uploadModes.push(artifact.mode)
        return {
          artifactId: `artifact-${uploadModes.length}`,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          headers: {},
          url: "https://storage.example/artifact",
        }
      },
      async applySourceUpload() {
        applications += 1
        if (applications === 1) {
          throw new CloudPreviewRequestError(
            503,
            {
              code: "SOURCE_SYNC_FAILED",
              providerCode: "BASELINE_SNAPSHOT_NOT_FOUND",
              retryable: true,
            },
            "baseline unavailable",
          )
        }
        return session
      },
      async command(_sessionId: string, command: { type: string }) {
        commands.push(command.type)
        return session
      },
    } as unknown as CloudPreviewClient

    const result = await service.syncInitial(client, session.id, root)

    assert.equal(result.session, session)
    assert.equal(negotiations, 2)
    assert.deepEqual(uploadModes, ["delta", "full"])
    assert.deepEqual(commands, ["resume-host"])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
