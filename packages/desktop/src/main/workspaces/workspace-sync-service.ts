import { randomUUID } from "node:crypto"
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import {
  ATTR_BLAME_OPERATION_STATUS,
  ATTR_BLAME_RUNTIME_NAME,
  ATTR_BLAME_RUNTIME_PHASE,
  getBlameTelemetry,
} from "@blame/telemetry"
import type { CloudPreviewClient } from "../preview-runtime/cloud-preview-client"
import {
  buildWorkspaceArtifact,
  buildWorkspaceDeltaArtifact,
  prepareWorkspaceSource,
} from "./workspace-artifact"
import { applyWorkspaceDelta } from "./workspace-delta"
import { WorkspaceSyncConflict } from "./workspace-sync-conflict"

const maximumArtifactBytes = 256 * 1024 * 1024

export class WorkspaceSyncService {
  private readonly workspaces = new Map<string, string>()
  private readonly sessionsByWorkspace = new Map<string, string>()
  private readonly syncingBack = new Map<string, Promise<Awaited<ReturnType<WorkspaceSyncService["performSyncBack"]>>>>()
  private loaded = false

  constructor(private readonly indexPath?: string) {}

  async syncInitial(
    client: CloudPreviewClient,
    sessionId: string,
    localPath: string,
    beforeTransfer?: (root: string) => void | Promise<void>,
  ) {
    const root = await realpath(localPath)
    await beforeTransfer?.(root)
    const prepared = await measureWorkspacePhase("workspace.capture", () => prepareWorkspaceSource(root))
    const negotiation = await client.negotiateSource(sessionId, prepared.metadata)
    const artifact = await measureWorkspacePhase(
      negotiation.baseline ? "workspace.delta.build" : "workspace.full.build",
      () =>
        negotiation.baseline
          ? buildWorkspaceDeltaArtifact(root, prepared)
          : buildWorkspaceArtifact(root, prepared),
    )
    const target = await client.prepareSourceUpload(sessionId, {
      ...artifact,
      mode: negotiation.baseline ? "delta" : "full",
    })
    await measureWorkspacePhase("workspace.upload", () => upload(target, artifact.content))
    const session = await measureWorkspacePhase("workspace.apply", () =>
      client.applySourceUpload(sessionId, target.artifactId, negotiation.baseline?.id),
    )
    await this.remember(sessionId, root)
    return {
      session,
      sourceRevision: artifact.sourceRevision,
      workspaceHash: artifact.workspaceHash,
    }
  }

  syncBack(
    client: CloudPreviewClient,
    sessionId: string,
    localPath?: string,
    beforeTransfer?: (root: string) => void | Promise<void>,
  ) {
    const current = this.syncingBack.get(sessionId)
    if (current) return current
    const operation = this.performSyncBack(client, sessionId, localPath, beforeTransfer).finally(() => {
      if (this.syncingBack.get(sessionId) === operation) this.syncingBack.delete(sessionId)
    })
    this.syncingBack.set(sessionId, operation)
    return operation
  }

  private async performSyncBack(
    client: CloudPreviewClient,
    sessionId: string,
    localPath?: string,
    beforeTransfer?: (root: string) => void | Promise<void>,
  ) {
    await this.load()
    const attached = localPath ? await realpath(localPath) : undefined
    const remembered = this.workspaces.get(sessionId)
    if (remembered && attached && remembered !== attached) {
      throw new Error("Cloud preview is attached to a different local worktree")
    }
    const root = remembered ?? attached
    if (!root) throw new Error("Cloud preview has no registered local worktree")
    await beforeTransfer?.(root)
    await this.remember(sessionId, root)
    const delta = await client.exportSourceDelta(sessionId)
    const content = await download(delta.url, delta.size)
    let applied: Awaited<ReturnType<typeof applyWorkspaceDelta>>
    try {
      applied = await applyWorkspaceDelta({
        root,
        content,
        sha256: delta.sha256,
        size: delta.size,
        expectedBaseHash: delta.baseHash,
        expectedFinalHash: delta.finalHash,
        expectedGeneration: delta.generation,
      })
    } catch (error) {
      if (error instanceof WorkspaceSyncConflict) {
        await client.command(
          sessionId,
          { type: "report-sync-conflict" },
          randomUUID(),
        ).catch(() => undefined)
      }
      throw error
    }
    const session = await client.command(
      sessionId,
      { type: "ack-local-sync", deltaRevision: delta.revision ?? applied.revision },
      randomUUID(),
    )
    return { session, ...applied }
  }

  async barrier(client: CloudPreviewClient, localPath: string) {
    await this.load()
    const root = await realpath(localPath)
    const sessionId = this.sessionsByWorkspace.get(root)
    if (!sessionId) return
    let session = await client.get(sessionId)
    if (session.state.agent !== "idle") {
      session = await client.command(sessionId, { type: "stop-agent" }, randomUUID())
    }
    if (!["idle", "stopped", "failed"].includes(session.state.engine)) {
      await client.command(sessionId, { type: "stop-services" }, randomUUID())
    }
    await this.syncBack(client, sessionId, root)
  }

  async workspaceForSession(sessionId: string) {
    await this.load()
    return this.workspaces.get(sessionId)
  }

  private async remember(sessionId: string, root: string) {
    await this.load()
    const previousRoot = this.workspaces.get(sessionId)
    if (previousRoot) this.sessionsByWorkspace.delete(previousRoot)
    this.workspaces.set(sessionId, root)
    this.sessionsByWorkspace.set(root, sessionId)
    await this.persist()
  }

  private async load() {
    if (this.loaded) return
    this.loaded = true
    if (!this.indexPath) return
    try {
      const entries = JSON.parse(await readFile(this.indexPath, "utf8")) as unknown
      if (!Array.isArray(entries)) return
      for (const entry of entries) {
        if (!Array.isArray(entry) || entry.length !== 2) continue
        const [sessionId, root] = entry
        if (typeof sessionId !== "string" || typeof root !== "string") continue
        this.workspaces.set(sessionId, root)
        this.sessionsByWorkspace.set(root, sessionId)
      }
    } catch {}
  }

  private async persist() {
    if (!this.indexPath) return
    await mkdir(dirname(this.indexPath), { recursive: true, mode: 0o700 })
    const temporary = `${this.indexPath}.tmp`
    await writeFile(temporary, JSON.stringify([...this.workspaces]), { mode: 0o600 })
    await rename(temporary, this.indexPath)
  }
}
async function upload(
  target: { url: string; headers: Record<string, string>; expiresAt: string },
  content: Uint8Array,
) {
  if (Date.parse(target.expiresAt) <= Date.now()) throw new Error("Workspace upload URL expired")
  const response = await fetch(validatedArtifactUrl(target.url), {
    method: "PUT",
    headers: target.headers,
    body: Buffer.from(content),
    redirect: "error",
  })
  if (!response.ok) throw new Error("Workspace upload failed")
}

async function download(value: string, expectedSize: number) {
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > maximumArtifactBytes) {
    throw new Error("Workspace delta size is invalid")
  }
  const response = await fetch(validatedArtifactUrl(value), { redirect: "error" })
  if (!response.ok || !response.body) throw new Error("Workspace delta download failed")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    while (true) {
      const { done, value: chunk } = await reader.read()
      if (done) break
      received += chunk.byteLength
      if (received > expectedSize) {
        await reader.cancel("Workspace delta exceeded its declared size")
        throw new Error("Workspace delta size mismatch")
      }
      chunks.push(chunk)
    }
  } finally {
    reader.releaseLock()
  }
  if (received !== expectedSize) throw new Error("Workspace delta size mismatch")
  const content = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    content.set(chunk, offset)
    offset += chunk.byteLength
  }
  return content
}

function validatedArtifactUrl(value: string) {
  const url = new URL(value)
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username || url.password || url.hash) {
    throw new Error("Workspace artifact URL is invalid")
  }
  return url
}

async function measureWorkspacePhase<T>(phase: string, operation: () => Promise<T>) {
  const startedAt = performance.now()
  let outcome = "succeeded"
  try {
    return await operation()
  } catch (error) {
    outcome = "failed"
    throw error
  } finally {
    const attributes = {
      [ATTR_BLAME_RUNTIME_NAME]: "vercel-compose",
      [ATTR_BLAME_RUNTIME_PHASE]: phase,
      [ATTR_BLAME_OPERATION_STATUS]: outcome,
    }
    const telemetry = getBlameTelemetry()
    telemetry.count("blame.runtime.phase.count", 1, attributes)
    telemetry.record(
      "blame.runtime.phase.duration",
      Math.max(0, performance.now() - startedAt) / 1_000,
      attributes,
    )
  }
}
