import { BlameAgentRuntime, type AgentEvent } from "@blame/agent-runtime"
import { withoutTelemetryEnvironment } from "@blame/telemetry"
import { BrowserWindow, ipcMain, shell } from "electron"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import {
  codeReviewGraphProvider,
  shutdownCodeReviewGraph,
} from "./code-review-graph"
import { optimizeDevelopmentAttachments } from "./attachment-ai-context"
import { resolveAgentWorkspaceInput } from "./cline-backend-resolver"
import { getPreviewDevtoolsTarget } from "./preview-browser-ipc"
import { AgentEventStream } from "./agent-event-stream"
import {
  run as runRuntime,
  runtimeManagedPath,
  ensureRuntimeGitUserIdentity,
  getRuntimeGitIdentity,
} from "./workspace-runtime"

const execFileAsync = promisify(execFile)

const runtime = new BlameAgentRuntime({
  emit(event) {
    emitAgentEvent(event)
  },
}, {
  codeReviewGraph: codeReviewGraphProvider,
  openExternalUrl(url) {
    void shell.openExternal(url)
  },
  async git(cwd, args) {
    if (runtimeManagedPath(cwd)) {
      await ensureRuntimeGitUserIdentity();
      const { name, email } = getRuntimeGitIdentity();
      const gitEnv = {
        ...withoutTelemetryEnvironment(process.env),
        GIT_TERMINAL_PROMPT: "0",
        GIT_SSH_COMMAND: process.platform === "win32"
          ? "ssh.exe -o BatchMode=yes -o StrictHostKeyChecking=no"
          : "ssh -o BatchMode=yes -o StrictHostKeyChecking=no",
        ...(name ? { GIT_AUTHOR_NAME: name, GIT_COMMITTER_NAME: name } : {}),
        ...(email ? { GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_EMAIL: email } : {}),
      };
      const { stdout } = await runRuntime("git", args, { cwd, env: gitEnv });
      return stdout;
    }
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      env: withoutTelemetryEnvironment(process.env),
      maxBuffer: 20 * 1024 * 1024,
    });
    return stdout;
  },
  previewDevtools: getPreviewDevtoolsTarget,
  previewContainerLogs: async (input) => {
    const { readProjectServiceLogs } = await import("./workspace-ipc")
    return readProjectServiceLogs(input)
  },
})

export function registerAgentIpcHandlers() {
  ipcMain.handle("agent:providers:list", (_event, connection) => runtime.providers.list(connection))
  ipcMain.handle("agent:providers:save-credential", (_event, connection, input) =>
    runtime.providers.saveCredential(connection, input)
  )
  ipcMain.handle("agent:providers:delete-credential", (_event, connection, id) =>
    runtime.providers.deleteCredential(connection, id)
  )
  ipcMain.handle("agent:providers:login-oauth", (_event, input) => runtime.providers.loginOAuth(input))
  ipcMain.handle("agent:sessions:start", async (_event, input) => {
    const session = await runtime.sessions.start(await agentWorkspaceInput(input))
    eventStream.beginSession(session.sessionId)
    return session
  })
  ipcMain.handle("agent:sessions:start-development", async (_event, input) => {
    const session = await runtime.sessions.startDevelopment(
      await optimizeDevelopmentAttachments(await agentWorkspaceInput(input))
    )
    eventStream.beginSession(session.sessionId)
    return session
  })
  ipcMain.handle("agent:sessions:send", (_event, input) =>
    runtime.sessions.send(input)
  )
  ipcMain.handle("agent:sessions:send-development", async (_event, input) => {
    return runtime.sessions.sendDevelopment(
      await optimizeDevelopmentAttachments(input)
    )
  })
  ipcMain.handle("agent:sessions:abort", (_event, sessionId) => runtime.sessions.abort(sessionId))
  ipcMain.handle("agent:sessions:compare-checkpoint", (_event, input) =>
    runtime.sessions.compareCheckpoint(input)
  )
  ipcMain.handle("agent:sessions:list", () => runtime.sessions.list())
  ipcMain.handle("agent:sessions:messages", (_event, sessionId) => runtime.sessions.messages(sessionId))
  ipcMain.handle("agent:sessions:restore-checkpoint", (_event, input) =>
    runtime.sessions.restoreCheckpoint(input)
  )
  ipcMain.handle("agent:sessions:usage", (_event, sessionId) => runtime.sessions.usage(sessionId))
  ipcMain.handle("agent:sessions:event-stream-url", (_event, sessionId) => agentEventStreamUrl(sessionId))
  ipcMain.on("agent:sessions:listen", (event, sessionId: string) => {
    registerRendererAgentEventCleanup(event.sender)
    setRendererAgentEventSubscription(event.sender.id, sessionId, true)
  })
  ipcMain.on("agent:sessions:unlisten", (event, sessionId: string) =>
    setRendererAgentEventSubscription(event.sender.id, sessionId, false)
  )
  ipcMain.handle("agent:approvals:resolve", (_event, input) => runtime.approvals.resolve(input))
  ipcMain.handle("agent:initializations:run", (_event, input) =>
    agentWorkspaceInput(input).then((resolved) => runtime.initializations.run(resolved))
  )
  ipcMain.handle("agent:initializations:repair", (_event, input) =>
    agentWorkspaceInput(input).then((resolved) => runtime.initializations.repair(resolved))
  )
  ipcMain.handle("agent:initializations:assess-impact", (_event, input) =>
    agentWorkspaceInput(input).then((resolved) => runtime.initializations.assessImpact(resolved))
  )
  ipcMain.handle("agent:code-practices:run", (_event, input) =>
    agentWorkspaceInput(input).then((resolved) => runtime.codePractices.run(resolved))
  )
  ipcMain.handle("agent:new-projects:generate", (_event, input) => runtime.newProjects.generate(input))
  ipcMain.handle("agent:prompt-optimizer:optimize-user-story", (_event, input) =>
    agentWorkspaceInput(input).then((resolved) => runtime.promptOptimizer.optimizeUserStory(resolved))
  )
  ipcMain.handle("agent:prompt-optimizer:generate-title", (_event, input) =>
    agentWorkspaceInput(input).then((resolved) => runtime.promptOptimizer.generateTitle(resolved))
  )
  ipcMain.handle("agent:approve-and-merge", (_event, input) =>
    agentWorkspaceInput(input).then((resolved) => runtime.approveAndMerge(resolved))
  )
  ipcMain.handle("agent:generate-commit-message", (_event, input) =>
    agentWorkspaceInput(input).then((resolved) => runtime.generateCommitMessage(resolved))
  )
  ipcMain.handle("agent:resolve-merge-conflicts", (_event, input) =>
    agentWorkspaceInput(input).then((resolved) => runtime.resolveMergeConflicts(resolved))
  )
}

export function generateNewProjectWithAgent(
  input: Parameters<typeof runtime.newProjects.generate>[0]
) {
  return agentWorkspaceInput(input).then((resolved) => runtime.newProjects.generate(resolved))
}

export function releaseAgentWorkspaceSessions(worktree: string) {
  return runtime.sessions.releaseWorkspace(worktree)
}

export async function shutdownAgentRuntime() {
  shutdownAgentEventServer()
  await Promise.allSettled([runtime.shutdown(), shutdownCodeReviewGraph()])
}

function emitAgentEvent(event: AgentEvent) {
  const transportEvent = agentTransportEvent(event)
  eventStream.publish(transportEvent)
  BrowserWindow.getAllWindows().forEach((window) => {
    if (
      transportEvent.sessionId &&
      rendererAgentEventSubscriptions
        .get(window.webContents.id)
        ?.has(transportEvent.sessionId)
    ) {
      window.webContents.send(
        `agent:sessions:event:${transportEvent.sessionId}`,
        transportEvent
      )
    }
    if (transportEvent.type === "approval") {
      window.webContents.send("agent:approvals:event", transportEvent)
    }
  })
}

function agentTransportEvent(event: AgentEvent): AgentEvent {
  return {
    ...event,
    payload: agentTransportPayload(event.payload),
  }
}

function agentTransportPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("raw" in payload)) {
    return payload
  }
  const { raw, ...transportPayload } = payload as Record<string, unknown>
  void raw
  return transportPayload
}

export function agentWorkspaceInput<T extends Record<string, unknown>>(input: T) {
  return resolveAgentWorkspaceInput(input)
}


const eventStream = new AgentEventStream()
const rendererAgentEventSubscriptions = new Map<number, Map<string, number>>()
const rendererAgentEventCleanupRegistered = new Set<number>()
let streamServer: ReturnType<typeof createServer> | undefined
let streamServerUrl: string | undefined

async function agentEventStreamUrl(sessionId: string) {
  const url = await ensureAgentEventServer()
  return eventStream.url(sessionId, url)
}

function ensureAgentEventServer() {
  if (streamServerUrl) return Promise.resolve(streamServerUrl)
  if (streamServer) return waitForAgentEventServer()
  streamServer = createServer((request, response) => {
    if (!eventStream.handle(request, response)) notFound(response)
  })
  streamServer.listen(0, "127.0.0.1")
  return waitForAgentEventServer()
}

function waitForAgentEventServer() {
  return new Promise<string>((resolve, reject) => {
    if (!streamServer) return reject(new Error("Agent event stream is unavailable."))
    streamServer.once("error", reject)
    streamServer.once("listening", () => {
      const address = streamServer?.address() as AddressInfo | null
      if (!address) return reject(new Error("Agent event stream is unavailable."))
      streamServerUrl = `http://127.0.0.1:${address.port}`
      resolve(streamServerUrl)
    })
  })
}

function notFound(response: import("node:http").ServerResponse) {
  response.writeHead(404)
  response.end()
}

function shutdownAgentEventServer() {
  eventStream.close()
  rendererAgentEventSubscriptions.clear()
  rendererAgentEventCleanupRegistered.clear()
  streamServer?.close()
  streamServer = undefined
  streamServerUrl = undefined
}

function registerRendererAgentEventCleanup(
  renderer: import("electron").WebContents
) {
  if (rendererAgentEventCleanupRegistered.has(renderer.id)) return
  rendererAgentEventCleanupRegistered.add(renderer.id)
  renderer.once("destroyed", () => {
    rendererAgentEventSubscriptions.delete(renderer.id)
    rendererAgentEventCleanupRegistered.delete(renderer.id)
  })
}

function setRendererAgentEventSubscription(
  rendererId: number,
  sessionId: string,
  listening: boolean
) {
  const sessions =
    rendererAgentEventSubscriptions.get(rendererId) ?? new Map<string, number>()
  const count = sessions.get(sessionId) ?? 0
  if (listening) sessions.set(sessionId, count + 1)
  else if (count > 1) sessions.set(sessionId, count - 1)
  else sessions.delete(sessionId)
  if (sessions.size) rendererAgentEventSubscriptions.set(rendererId, sessions)
  else rendererAgentEventSubscriptions.delete(rendererId)
}
