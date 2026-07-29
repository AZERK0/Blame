import type {
  AgentEvent,
  NewProjectGenerationResult,
  StartNewProjectGenerationInput,
} from "@blame/agent-runtime"
import { BrowserWindow, ipcMain } from "electron"
import { randomUUID } from "node:crypto"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import log from "electron-log"
import { shutdownCodeReviewGraph } from "./code-review-graph"
import { optimizeDevelopmentAttachments } from "./attachment-ai-context"
import {
  refreshRuntimeBackendConnection,
  resolveAgentWorkspaceInput,
  retryableHubTransportError,
} from "./cline-backend-resolver"
import { AgentEventStream } from "./agent-event-stream"
import { AgentRuntimePool } from "./agent-runtime-pool"
import {
  AgentRuntimeProcessClient,
  type AgentRuntimeProcessCallbacks,
} from "./agent-runtime-process-client"
import { handleAgentHostRequest } from "./agent-runtime-main-host"
import { getRuntimeStatus } from "./runtime-manager"
import { runtimeAgentClient } from "./runtime-agent"

type AgentRuntimeRegistration = {
  modulePath: string
  packaged: boolean
  serviceVersion: string
}

let runtime: AgentRuntimePool | undefined
let runtimePrewarmPromise: Promise<boolean> | undefined
const runtimePrewarmWorkspace =
  "/home/blame/.local/share/blame/runtime/worktrees/.prewarm"

export function registerAgentIpcHandlers(input: AgentRuntimeRegistration) {
  runtime ??= createAgentRuntimePool(input)
  registerProviderIpcHandlers()
  registerSessionStartIpcHandlers()
  registerSessionControlIpcHandlers()
  registerSessionDataIpcHandlers()
  registerSessionEventIpcHandlers()
  registerAnalysisWorkflowIpcHandlers()
  registerDeliveryWorkflowIpcHandlers()
}

export function prewarmAgentRuntime(runtimeAlreadyReady = false) {
  if (process.platform !== "darwin") return Promise.resolve(false)
  if (runtimePrewarmPromise) return runtimePrewarmPromise
  const startedAt = Date.now()
  const prewarm = prewarmMacosAgentRuntime(runtimeAlreadyReady)
    .then((ready) => {
      if (ready) {
        log.info(
          `Agent runtime prewarm completed in ${Date.now() - startedAt}ms`
        )
      }
      return ready
    })
    .catch((error) => {
      log.warn("Agent runtime prewarm failed", error)
      return false
    })
  runtimePrewarmPromise = prewarm
  void prewarm.then((ready) => {
    if (!ready && runtimePrewarmPromise === prewarm) {
      runtimePrewarmPromise = undefined
    }
  })
  return prewarm
}

async function prewarmMacosAgentRuntime(runtimeAlreadyReady: boolean) {
  const report = runtimeAlreadyReady ? undefined : await getRuntimeStatus()
  if (report && report.status !== "ready") return false
  const client = runtimeAgentClient()
  await client.exec({
    args: ["-p", runtimePrewarmWorkspace],
    command: "mkdir",
    user: "blame",
  })
  const workspace = await resolveAgentWorkspaceInput(
    {
      cwd: runtimePrewarmWorkspace,
      workspaceRoot: runtimePrewarmWorkspace,
    },
    {
      agentClient: client,
      ensureReady: async () =>
        report ?? {
          issues: [],
          platform: "darwin",
          runtime: "BlameRuntime",
          status: "ready",
        },
      platform: "darwin",
    }
  )
  await agentRuntime().run("runtime.prewarm", workspace)
  return true
}

function registerProviderIpcHandlers() {
  ipcMain.handle("agent:providers:list", (_event, connection) =>
    agentRuntime().run("providers.list", connection)
  )
  ipcMain.handle("agent:providers:save-credential", (_event, connection, input) =>
    agentRuntime().run("providers.saveCredential", [connection, input])
  )
  ipcMain.handle("agent:providers:delete-credential", (_event, connection, id) =>
    agentRuntime().run("providers.deleteCredential", [connection, id])
  )
  ipcMain.handle("agent:providers:login-oauth", (_event, input) =>
    agentRuntime().run("providers.loginOAuth", input)
  )
}

function registerSessionStartIpcHandlers() {
  ipcMain.handle("agent:sessions:start", async (_event, input) => {
    const session = await agentRuntime().startSession(
      "sessions.start",
      await agentWorkspaceInput(input)
    )
    eventStream.beginSession(session.sessionId)
    return session
  })
  ipcMain.handle("agent:sessions:start-development", async (_event, input) => {
    const prepared = await optimizeDevelopmentAttachments(
      await agentWorkspaceInput({
        ...input,
        sessionId:
          typeof input.sessionId === "string" && input.sessionId.trim()
            ? input.sessionId
            : `${Date.now()}_${randomUUID().replaceAll("-", "").slice(0, 5)}`,
      }),
    )
    let session
    try {
      session = await agentRuntime().startSession(
        "sessions.startDevelopment",
        prepared,
      )
    } catch (error) {
      if (!retryableHubTransportError(error)) throw error
      log.warn(
        "Cline hub connection closed during session start; refreshing the runtime backend and retrying once",
      )
      session = await agentRuntime().startSession(
        "sessions.startDevelopment",
        refreshRuntimeBackendConnection(await agentWorkspaceInput(prepared)),
      )
    }
    eventStream.beginSession(session.sessionId)
    return session
  })
}

function registerSessionControlIpcHandlers() {
  ipcMain.handle("agent:sessions:send", (_event, input) =>
    agentRuntime().runSession("sessions.send", input.sessionId, input)
  )
  ipcMain.handle("agent:sessions:send-development", async (_event, input) => {
    return agentRuntime().runSession(
      "sessions.sendDevelopment",
      input.sessionId,
      await optimizeDevelopmentAttachments(input),
    )
  })
  ipcMain.handle("agent:sessions:abort", (_event, sessionId) =>
    agentRuntime().abortSession(sessionId)
  )
}

function registerSessionDataIpcHandlers() {
  ipcMain.handle("agent:sessions:compare-checkpoint", (_event, input) =>
    agentRuntime().runSession(
      "sessions.compareCheckpoint",
      input.sessionId,
      input,
    )
  )
  ipcMain.handle("agent:sessions:list", () => agentRuntime().listSessions())
  ipcMain.handle("agent:sessions:messages", (_event, sessionId) =>
    agentRuntime().runSession("sessions.messages", sessionId, sessionId)
  )
  ipcMain.handle("agent:sessions:restore-checkpoint", (_event, input) =>
    agentRuntime().runSession(
      "sessions.restoreCheckpoint",
      input.sessionId,
      input,
    )
  )
  ipcMain.handle("agent:sessions:usage", (_event, sessionId) =>
    agentRuntime().runSession("sessions.usage", sessionId, sessionId)
  )
  ipcMain.handle("agent:sessions:event-stream-url", (_event, sessionId) =>
    agentEventStreamUrl(sessionId)
  )
}

function registerSessionEventIpcHandlers() {
  ipcMain.on("agent:sessions:listen", (event, sessionId: string) => {
    registerRendererAgentEventCleanup(event.sender)
    setRendererAgentEventSubscription(event.sender.id, sessionId, true)
  })
  ipcMain.on("agent:sessions:unlisten", (event, sessionId: string) =>
    setRendererAgentEventSubscription(event.sender.id, sessionId, false)
  )
  ipcMain.handle("agent:approvals:resolve", (_event, input) =>
    agentRuntime().resolveApproval(input)
  )
}

function registerAnalysisWorkflowIpcHandlers() {
  ipcMain.handle("agent:initializations:run", (_event, input) =>
    agentWorkspaceInput(input).then((resolved) =>
      agentRuntime().run("initializations.run", resolved)
    )
  )
  ipcMain.handle("agent:initializations:repair", (_event, input) =>
    agentWorkspaceInput(input).then((resolved) =>
      agentRuntime().run("initializations.repair", resolved)
    )
  )
  ipcMain.handle("agent:initializations:assess-impact", (_event, input) =>
    agentWorkspaceInput(input).then((resolved) =>
      agentRuntime().run("initializations.assessImpact", resolved)
    )
  )
  ipcMain.handle("agent:code-practices:run", (_event, input) =>
    agentWorkspaceInput(input).then((resolved) =>
      agentRuntime().run("codePractices.run", resolved)
    )
  )
}

function registerDeliveryWorkflowIpcHandlers() {
  ipcMain.handle("agent:new-projects:generate", (_event, input) =>
    agentRuntime().run("newProjects.generate", input)
  )
  ipcMain.handle("agent:prompt-optimizer:optimize-user-story", (_event, input) =>
    agentWorkspaceInput(input).then((resolved) =>
      agentRuntime().run("promptOptimizer.optimizeUserStory", resolved)
    )
  )
  ipcMain.handle("agent:prompt-optimizer:generate-title", (_event, input) =>
    agentWorkspaceInput(input).then((resolved) =>
      agentRuntime().run("promptOptimizer.generateTitle", resolved)
    )
  )
  ipcMain.handle("agent:approve-and-merge", (_event, input) =>
    agentWorkspaceInput(input).then((resolved) =>
      agentRuntime().run("approveAndMerge", resolved)
    )
  )
  ipcMain.handle("agent:generate-commit-message", (_event, input) =>
    agentWorkspaceInput(input).then((resolved) =>
      agentRuntime().run("generateCommitMessage", resolved)
    )
  )
  ipcMain.handle("agent:resolve-merge-conflicts", (_event, input) =>
    agentWorkspaceInput(input).then((resolved) =>
      agentRuntime().run("resolveMergeConflicts", resolved)
    )
  )
}

export function generateNewProjectWithAgent(
  input: StartNewProjectGenerationInput
) {
  return agentWorkspaceInput(input).then((resolved) =>
    agentRuntime().run<NewProjectGenerationResult>(
      "newProjects.generate",
      resolved
    )
  )
}

export function releaseAgentWorkspaceSessions(worktree: string) {
  return agentRuntime().releaseWorkspace(worktree)
}

export async function shutdownAgentRuntime() {
  shutdownAgentEventServer()
  const currentRuntime = runtime
  runtime = undefined
  await Promise.allSettled([
    currentRuntime?.shutdown(),
    shutdownCodeReviewGraph(),
  ])
}

export function configureAgentRuntimeTelemetry(session: unknown) {
  return runtime?.configureTelemetry(session)
}

export function disableAgentRuntimeTelemetry() {
  return runtime?.disableTelemetry()
}

function createAgentRuntimePool(input: AgentRuntimeRegistration) {
  const environment = {
    ...process.env,
    BLAME_AGENT_PACKAGED: String(input.packaged),
    BLAME_AGENT_SERVICE_VERSION: input.serviceVersion,
  }
  return new AgentRuntimePool({
    createProcess: (callbacks) =>
      createAgentRuntimeProcess(input.modulePath, environment, callbacks),
    handleHostRequest: handleAgentHostRequest,
    onEvent: emitAgentEvent,
  })
}

function createAgentRuntimeProcess(
  modulePath: string,
  environment: NodeJS.ProcessEnv,
  callbacks: AgentRuntimeProcessCallbacks,
) {
  return new AgentRuntimeProcessClient({
    ...callbacks,
    environment,
    modulePath,
  })
}

function agentRuntime() {
  if (!runtime) throw new Error("Agent runtime is not initialized")
  return runtime
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
