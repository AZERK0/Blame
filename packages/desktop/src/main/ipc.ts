import type { BrowserWindow } from "electron"
import { localAgentOwnsWorkspace, registerAgentIpcHandlers } from "./agent-ipc"
import { registerBacklogStatusPipIpcHandlers } from "./backlog-status-pip-ipc"
import { registerCloudAuthIpcHandlers } from "./cloud-auth-ipc"
import { registerDesktopUpdateIpcHandlers } from "./desktop-update-ipc"
import { registerMcpIpcHandlers } from "./mcp-ipc"
import { registerPreviewBrowserIpcHandlers } from "./preview-browser-ipc"
import { PreviewService } from "./preview-runtime/preview-service"
import { registerPreviewRuntimeIpcHandlers } from "./ipc/preview-runtime-ipc"
import { registerTelemetryIpcHandlers } from "./telemetry-ipc"
import { registerTerminalIpcHandlers } from "./terminal-ipc"
import { registerWorkspaceIpcHandlers } from "./workspace-ipc"

export type DesktopIpcOptions = {
  mainWindow(): BrowserWindow | undefined
  packaged: boolean
  registerCoreHandlers(): void
  backlogStatusPip: {
    preloadPath: string
    rendererFile: string
    rendererUrl?: string
  }
  agentRuntime: {
    modulePath: string
    serviceVersion: string
  }
  telemetry: {
    configure: NonNullable<Parameters<typeof registerTelemetryIpcHandlers>[0]>["configure"]
    disable: NonNullable<Parameters<typeof registerTelemetryIpcHandlers>[0]>["disable"]
  }
  beforeInstall(): Promise<void>
  onRuntimeReady(): void
}

export function registerDesktopIpcHandlers(options: DesktopIpcOptions) {
  const previews = new PreviewService(localAgentOwnsWorkspace, options.packaged)
  options.registerCoreHandlers()
  registerCloudAuthIpcHandlers({ mainWindow: options.mainWindow, packaged: options.packaged })
  registerBacklogStatusPipIpcHandlers({
    mainWindow: options.mainWindow,
    ...options.backlogStatusPip,
  })
  registerAgentIpcHandlers({
    ...options.agentRuntime,
    packaged: options.packaged,
    beforeDelivery: (worktree) => previews.syncBarrier(worktree),
    beforeWorkspaceWrite: (worktree) => previews.syncBarrier(worktree),
  })
  registerPreviewRuntimeIpcHandlers({ mainWindow: options.mainWindow, service: previews })
  registerPreviewBrowserIpcHandlers({ bridgeGrant: (sessionId) => previews.bridgeGrant(sessionId) })
  registerMcpIpcHandlers()
  registerTerminalIpcHandlers()
  registerTelemetryIpcHandlers(options.telemetry)
  registerDesktopUpdateIpcHandlers({ beforeInstall: options.beforeInstall })
  registerWorkspaceIpcHandlers({
    beforeGitWrite: (worktree) => previews.syncBarrier(worktree),
    onRuntimeReady: options.onRuntimeReady,
  })
}
