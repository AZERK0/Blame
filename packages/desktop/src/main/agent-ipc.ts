import { BlameAgentRuntime, type AgentEvent } from "@blame/agent-runtime"
import { BrowserWindow, ipcMain, shell } from "electron"
import { createServer, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import {
  codeReviewGraphProvider,
  shutdownCodeReviewGraph,
} from "./code-review-graph"
import { resolveAgentWorkspaceInput } from "./cline-backend-resolver"
import { getPreviewDevtoolsTarget } from "./preview-browser-ipc"
import {
  run as runRuntime,
  runtimeManagedPath,
  ensureRuntimeGitUserIdentity,
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
      const { stdout } = await runRuntime("git", args, { cwd });
      return stdout;
    }
    const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 20 * 1024 * 1024 });
    return stdout;
  },
  previewDevtools: getPreviewDevtoolsTarget,
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
  ipcMain.handle("agent:sessions:start", async (_event, input) =>
    runtime.sessions.start(await agentWorkspaceInput(input))
  )
  ipcMain.handle("agent:sessions:start-development", (_event, input) =>
    agentWorkspaceInput(input).then((resolved) => runtime.sessions.startDevelopment(resolved))
  )
  ipcMain.handle("agent:sessions:send", (_event, input) => runtime.sessions.send(input))
  ipcMain.handle("agent:sessions:send-development", (_event, input) => runtime.sessions.sendDevelopment(input))
  ipcMain.handle("agent:sessions:abort", (_event, sessionId) => runtime.sessions.abort(sessionId))
  ipcMain.handle("agent:sessions:list", () => runtime.sessions.list())
  ipcMain.handle("agent:sessions:messages", (_event, sessionId) => runtime.sessions.messages(sessionId))
  ipcMain.handle("agent:sessions:usage", (_event, sessionId) => runtime.sessions.usage(sessionId))
  ipcMain.handle("agent:sessions:event-stream-url", (_event, sessionId) => agentEventStreamUrl(sessionId))
  ipcMain.handle("agent:sessions:unsubscribe", (_event, sessionId) => runtime.sessions.unsubscribe(sessionId))
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
  ipcMain.handle("agent:new-projects:generate", (_event, input) => runtime.newProjects.generate(input))
  ipcMain.handle("agent:prompt-optimizer:optimize-user-story", (_event, input) =>
    agentWorkspaceInput(input).then((resolved) => runtime.promptOptimizer.optimizeUserStory(resolved))
  )
  ipcMain.handle("agent:approve-and-merge", (_event, input) =>
    agentWorkspaceInput(input).then((resolved) => runtime.approveAndMerge(resolved))
  )
}

export function generateNewProjectWithAgent(
  input: Parameters<typeof runtime.newProjects.generate>[0]
) {
  return agentWorkspaceInput(input).then((resolved) => runtime.newProjects.generate(resolved))
}

export async function shutdownAgentRuntime() {
  shutdownAgentEventServer()
  await Promise.allSettled([runtime.shutdown(), shutdownCodeReviewGraph()])
}

function emitAgentEvent(event: AgentEvent) {
  writeAgentEvent(event)
  BrowserWindow.getAllWindows().forEach((window) => {
    if (event.sessionId) window.webContents.send(`agent:sessions:event:${event.sessionId}`, event)
    if (event.type === "approval") window.webContents.send("agent:approvals:event", event)
  })
}

export function agentWorkspaceInput<T extends Record<string, unknown>>(input: T) {
  return resolveAgentWorkspaceInput(input)
}


const streamClients = new Map<string, Set<ServerResponse>>()
let streamServer: ReturnType<typeof createServer> | undefined
let streamServerUrl: string | undefined

async function agentEventStreamUrl(sessionId: string) {
  const url = await ensureAgentEventServer()
  return `${url}/agent/sessions/${encodeURIComponent(sessionId)}/events`
}

function ensureAgentEventServer() {
  if (streamServerUrl) return Promise.resolve(streamServerUrl)
  if (streamServer) return waitForAgentEventServer()
  streamServer = createServer((request, response) => {
    const sessionId = eventStreamSessionId(request.url)
    if (!sessionId) return notFound(response)
    registerStreamClient(sessionId, response)
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

function eventStreamSessionId(url: string | undefined) {
  const match = url?.match(/^\/agent\/sessions\/([^/]+)\/events(?:\?.*)?$/)
  return match ? decodeURIComponent(match[1]) : undefined
}

function registerStreamClient(sessionId: string, response: ServerResponse) {
  response.writeHead(200, {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
  })
  response.write("\n")
  const clients = streamClients.get(sessionId) ?? new Set<ServerResponse>()
  clients.add(response)
  streamClients.set(sessionId, clients)
  response.on("close", () => {
    clients.delete(response)
    if (clients.size === 0) streamClients.delete(sessionId)
  })
}

function writeAgentEvent(event: AgentEvent) {
  if (!event.sessionId) return
  const clients = streamClients.get(event.sessionId)
  if (!clients) return
  const data = `data: ${JSON.stringify(event)}\n\n`
  clients.forEach((client) => client.write(data))
}

function notFound(response: ServerResponse) {
  response.writeHead(404)
  response.end()
}

function shutdownAgentEventServer() {
  streamClients.forEach((clients) => clients.forEach((client) => client.end()))
  streamClients.clear()
  streamServer?.close()
  streamServer = undefined
  streamServerUrl = undefined
}
