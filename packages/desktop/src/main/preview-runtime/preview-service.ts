import type {
  PreviewSessionCommand,
  PreviewSessionEvent,
  PreviewSessionView,
} from "@blame/preview-runtime"
import {
  CloudPreviewClient,
  type CloudApiConnection,
  type CloudManagedPreviewCreateInput,
} from "./cloud-preview-client"
import { WorkspaceSyncService } from "../workspaces/workspace-sync-service"
import { app } from "electron"
import { join } from "node:path"
import { launchExternalPreview } from "./external-preview-launcher"

export class PreviewService {
  private cloud?: CloudPreviewClient
  private readonly sync = new WorkspaceSyncService(
    join(app.getPath("userData"), "preview-runtime", "workspace-index.json"),
  )

  constructor(
    private readonly localWriterActive: (worktree: string) => boolean = () => false,
    private readonly packaged = app.isPackaged,
  ) {}

  configureCloud(connection: CloudApiConnection) {
    this.cloud = new CloudPreviewClient(connection, { packaged: this.packaged })
  }

  clearCloud() {
    this.cloud = undefined
  }

  create(input: ManagedPreviewCreateInput) {
    return this.cloudClient().create(input)
  }

  async command(sessionId: string, command: PreviewSessionCommand, operationId: string) {
    if (command.type === "start-services" || command.type === "start-agent") {
      const workspace = await this.sync.workspaceForSession(sessionId)
      if (workspace) this.assertLocalWriterIdle(workspace)
    }
    return this.cloudClient().command(sessionId, command, operationId)
  }

  get(sessionId: string): Promise<PreviewSessionView> {
    return this.cloudClient().get(sessionId)
  }

  events(sessionId: string, cursor?: string): AsyncIterable<PreviewSessionEvent> {
    return this.cloudClient().events(sessionId, cursor)
  }

  bridgeGrant(sessionId: string) {
    return this.cloudClient().bridgeGrant(sessionId)
  }

  async openExternal(sessionId: string, endpointId?: string) {
    await launchExternalPreview(await this.cloudClient().accessTicket(sessionId, endpointId))
    return true
  }

  syncInitial(sessionId: string, localPath: string) {
    return this.sync.syncInitial(
      this.cloudClient(),
      sessionId,
      localPath,
      (root) => this.assertLocalWriterIdle(root),
    )
  }

  syncBack(sessionId: string, localPath?: string) {
    return this.sync.syncBack(
      this.cloudClient(),
      sessionId,
      localPath,
      (root) => this.assertLocalWriterIdle(root),
    )
  }

  syncBarrier(localPath: string) {
    if (!this.cloud) return Promise.resolve()
    return this.sync.barrier(this.cloud, localPath)
  }

  private cloudClient() {
    if (!this.cloud) throw new Error("Cloud preview is not connected")
    return this.cloud
  }

  private assertLocalWriterIdle(worktree: string) {
    if (this.localWriterActive(worktree)) {
      throw new Error(
        "Stop the local agent before starting or synchronizing this managed preview",
      )
    }
  }
}

export type ManagedPreviewCreateInput = CloudManagedPreviewCreateInput
