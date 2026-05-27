import { randomUUID } from "node:crypto"
import { appendFile, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"

import type {
  ClineCore,
  CoreSessionEvent,
  OAuthCredentials as ClineOAuthCredentials,
  OAuthPrompt,
  OAuthProviderInterface,
  OAuthServerListeningInfo,
  SessionUsageSummary,
} from "@cline/sdk"

import {
  deleteProviderCredential,
  listProviders,
  resolveProviderCredential,
  saveOAuthCredential,
  saveProviderCredential,
} from "./cloud-api.js"
import {
  projectInitializationCorrectionPrompt,
  parseProjectInitializationResult,
  projectInitializationPrompt,
  scanProjectForInitialization,
} from "./project-initialization.js"
import type { ProjectInitializationScan } from "./project-initialization.js"
import type {
  AgentApprovalRequest,
  AgentEvent,
  AgentRuntimeEvents,
  ApiConnection,
  InitializeProjectInput,
  InitializeProjectResult,
  LoginOAuthProviderInput,
  OAuthCredentials,
  ResolveApprovalInput,
  SaveProviderCredentialInput,
  SendSessionInput,
  StartSessionInput,
} from "./types.js"

const readTools = ["read_files", "search_codebase", "fetch_web_content"]
const writeTools = ["run_commands", "editor", "apply_patch"]
const maxInitializationAttempts = 3

type ToolApprovalRequest = {
  toolName?: string
  name?: string
  sessionId?: string
  reason?: string
  input?: unknown
}

type ToolApprovalResult = {
  approved: boolean
}

type PendingApproval = {
  request: AgentApprovalRequest
  resolve(result: ToolApprovalResult): void
}

type RuntimeSessionSummary = {
  sessionId?: string
}

type InitializationCorrection = {
  previousResult: string
  validationError: string
}

type RuntimeOptions = {
  openExternalUrl?(url: string): void
}

export class BlameAgentRuntime {
  private cline?: Promise<ClineCore>
  private unsubscribers = new Map<string, () => void>()
  private pendingApprovals = new Map<string, PendingApproval>()
  private alwaysAllowedTools = new Set<string>()
  private autoApprovedWriteToolSessions = new Set<string>()
  private sessionLogFiles = new Map<string, string>()
  private readonly events?: AgentRuntimeEvents
  private readonly options: RuntimeOptions

  constructor(events?: AgentRuntimeEvents, options: RuntimeOptions = {}) {
    this.events = events
    this.options = options
  }

  providers = {
    list: (connection: ApiConnection) => listProviders(connection),
    saveCredential: (connection: ApiConnection, input: SaveProviderCredentialInput) =>
      saveProviderCredential(connection, input),
    deleteCredential: (connection: ApiConnection, id: number) =>
      deleteProviderCredential(connection, { id }),
    loginOAuth: (input: LoginOAuthProviderInput) => this.loginOAuth(input),
  }

  sessions = {
    start: (input: StartSessionInput) => this.startSession(input),
    send: (input: SendSessionInput) => this.sendSession(input),
    abort: (sessionId: string) => this.abortSession(sessionId),
    list: () => this.listSessions(),
    messages: (sessionId: string) => this.readMessages(sessionId),
    usage: (sessionId: string) => this.readUsage(sessionId),
    unsubscribe: (sessionId: string) => this.unsubscribeSession(sessionId),
  }

  approvals = {
    resolve: (input: ResolveApprovalInput) => this.resolveApproval(input),
  }

  initializations = {
    run: (input: InitializeProjectInput) => this.initializeProject(input),
  }

  async shutdown() {
    const sessionIds = await this.activeSessionIds()
    await Promise.allSettled(sessionIds.map((sessionId) => this.abortSession(sessionId)))
    sessionIds.forEach((sessionId) => this.unsubscribeSession(sessionId))
    this.resolvePendingApprovals()
    this.sessionLogFiles.clear()
  }

  private async core() {
    if (!this.cline) {
      this.cline = import("@cline/sdk").then((module) =>
        module.ClineCore.create({
          clientName: "blame",
          backendMode: "auto",
          toolPolicies: toolPolicies(false),
          capabilities: {
            requestToolApproval: (request: ToolApprovalRequest) => this.requestApproval(request),
          },
          logger: runtimeLogger(),
        })
      )
    }
    return this.cline
  }

  private async startSession(input: StartSessionInput) {
    const startLogFile = startLogPath(input.cwd)
    await appendLog(startLogFile, "start requested", startContext(input))
    try {
      const credential = await resolveProviderCredential(input.apiConnection, {
        providerId: input.providerId,
        label: input.credentialLabel,
      })
      await appendLog(startLogFile, "credential resolved", {
        providerId: credential.providerId,
        authMethod: credential.authMethod,
        hasBaseUrl: !!credential.baseUrl,
      })
      const resolvedCredential = await this.refreshOAuthCredential(input.apiConnection, credential, {
        force: forceOAuthRefresh(credential.providerId),
      })
      await appendLog(startLogFile, "credential refreshed", {
        providerId: resolvedCredential.providerId,
        authMethod: resolvedCredential.authMethod,
        hasBaseUrl: !!resolvedCredential.baseUrl,
        expires: resolvedCredential.oauthCredentials?.expires,
      })
      await this.syncClineOAuthProviderSettings(resolvedCredential)
      if (resolvedCredential.authMethod === "oauth") {
        await appendLog(startLogFile, "cline oauth settings synced", {
          providerId: resolvedCredential.providerId,
          accountId: resolvedCredential.oauthCredentials?.accountId,
          email: resolvedCredential.oauthCredentials?.email,
          expires: resolvedCredential.oauthCredentials?.expires,
        })
      }
      const cline = await this.core()
      await appendLog(startLogFile, "cline core ready")
      const session = await cline.start({
        config: {
          providerId: input.providerId,
          modelId: input.modelId,
          apiKey: resolvedCredential.apiKey,
          baseUrl: resolvedCredential.baseUrl ?? undefined,
          thinking: !!input.reasoningEffort,
          reasoningEffort: input.reasoningEffort,
          systemPrompt: input.systemPrompt ?? "You are Blame, an agentic IDE coding assistant.",
          cwd: input.cwd,
          workspaceRoot: input.workspaceRoot,
          mode: input.mode ?? "act",
          maxIterations: input.maxIterations ?? 32,
          enableTools: true,
          enableSpawnAgent: false,
          enableAgentTeams: false,
        },
        interactive: true,
        source: "blame-desktop",
        toolPolicies: toolPolicies(!!input.autoApproveWriteTools),
      })
      const sessionLogFile = sessionLogPath(input.cwd, session.sessionId)
      this.sessionLogFiles.set(session.sessionId, sessionLogFile)
      await appendLog(startLogFile, "session created", {
        sessionId: session.sessionId,
        logFile: sessionLogFile,
      })
      await this.logSession(session.sessionId, "session created", {
        ...startContext(input),
        logFile: sessionLogFile,
      })
      if (input.autoApproveWriteTools) {
        this.autoApprovedWriteToolSessions.add(session.sessionId)
        this.emitSessionNotice(session.sessionId, "Development session write tools auto-approved.")
      }
      await this.subscribeSession(session.sessionId)
      await this.logSession(session.sessionId, "session subscribed")
      this.emitSessionNotice(session.sessionId, `Cline debug log: ${sessionLogFile}`)
      if (input.autoSendPrompt !== false) {
        void this.sendPrompt(cline, session.sessionId, input.prompt).catch(() => undefined)
      }
      if (input.autoSendPrompt === false) {
        await this.logSession(session.sessionId, "prompt deferred", {
          promptLength: input.prompt.length,
        })
      }
      return session
    } catch (error) {
      await appendLog(startLogFile, "start failed", { message: errorMessage(error) })
      throw error
    }
  }

  private async sendSession(input: SendSessionInput) {
    const cline = await this.core()
    return this.sendPrompt(cline, input.sessionId, input.prompt)
  }

  private async abortSession(sessionId: string) {
    const cline = await this.core()
    await cline.abort(sessionId, "User aborted from Blame")
  }

  private async listSessions() {
    const cline = await this.core()
    return cline.list(50)
  }

  private async readMessages(sessionId: string) {
    const cline = await this.core()
    return cline.readMessages(sessionId)
  }

  private async readUsage(sessionId: string): Promise<SessionUsageSummary | undefined> {
    const cline = await this.core()
    return cline.getAccumulatedUsage(sessionId)
  }

  private async initializeProject(input: InitializeProjectInput): Promise<InitializeProjectResult> {
    const resolvedCredential = await this.initializationCredential(input)
    const scan = await scanProjectForInitialization(input.workspaceRoot)
    const cline = await this.core()
    let correction = input.validationFeedback
    for (let attempt = 1; attempt <= maxInitializationAttempts; attempt += 1) {
      const session = await cline.start({
        prompt: initializationPrompt(scan, correction),
        config: initializationConfig(input, resolvedCredential),
        interactive: false,
        source: "blame-project-initialization",
        toolPolicies: initializationToolPolicies(),
      })
      const text = session.result?.text
      if (!text) throw new Error("Project initialization agent did not return a result")
      try {
        return {
          sessionId: session.sessionId,
          ...parseProjectInitializationResult(text),
        }
      } catch (error) {
        if (attempt === maxInitializationAttempts) throw error
        correction = {
          previousResult: text,
          validationError: errorMessage(error),
        }
      }
    }
    throw new Error("Project initialization agent did not return a valid result")
  }

  private async initializationCredential(input: InitializeProjectInput) {
    const credential = await resolveProviderCredential(input.apiConnection, {
      providerId: input.providerId,
      label: input.credentialLabel,
    })
    return this.refreshOAuthCredential(input.apiConnection, credential)
  }

  private async subscribeSession(sessionId: string) {
    this.unsubscribeSession(sessionId)
    const cline = await this.core()
    const unsubscribe = await cline.subscribe((payload: CoreSessionEvent) => {
      const event = normalizeEvent(sessionId, payload)
      void this.logSession(sessionId, `event:${event.type}`, payload)
      this.events?.emit(event)
    }, { sessionId })
    this.unsubscribers.set(sessionId, unsubscribe)
  }

  private unsubscribeSession(sessionId: string) {
    this.unsubscribers.get(sessionId)?.()
    this.unsubscribers.delete(sessionId)
    this.autoApprovedWriteToolSessions.delete(sessionId)
    void this.logSession(sessionId, "session unsubscribed")
  }

  private async activeSessionIds() {
    const sessionIds = new Set(this.unsubscribers.keys())
    if (!this.cline) return Array.from(sessionIds)

    try {
      const cline = await this.cline
      const sessions = (await cline.list(50)) as RuntimeSessionSummary[]
      sessions.forEach((session) => {
        if (session.sessionId) sessionIds.add(session.sessionId)
      })
    } catch {}

    return Array.from(sessionIds)
  }

  private resolvePendingApprovals() {
    this.pendingApprovals.forEach((approval) => approval.resolve({ approved: false }))
    this.pendingApprovals.clear()
    this.alwaysAllowedTools.clear()
    this.autoApprovedWriteToolSessions.clear()
  }

  private requestApproval(request: ToolApprovalRequest): Promise<ToolApprovalResult> | ToolApprovalResult {
    const toolName = request.toolName ?? request.name ?? "unknown"
    if (
      !writeTools.includes(toolName) ||
      this.alwaysAllowedTools.has(toolName) ||
      (request.sessionId && this.autoApprovedWriteToolSessions.has(request.sessionId))
    ) {
      this.events?.emit({
        type: "notice",
        sessionId: request.sessionId,
        payload: { message: `Auto-approved tool: ${toolName}` },
      })
      if (request.sessionId) void this.logSession(request.sessionId, "tool auto-approved", request)
      return { approved: true }
    }

    return new Promise((resolve) => {
      const approval = toApprovalRequest(request, toolName)
      this.pendingApprovals.set(approval.id, { request: approval, resolve })
      if (approval.sessionId) void this.logSession(approval.sessionId, "tool approval requested", approval)
      this.events?.emit({
        type: "approval",
        sessionId: approval.sessionId,
        payload: approval,
      })
    })
  }

  private resolveApproval(input: ResolveApprovalInput) {
    const pending = this.pendingApprovals.get(input.requestId)
    if (!pending) return false

    this.pendingApprovals.delete(input.requestId)
    if (input.decision === "always") this.alwaysAllowedTools.add(pending.request.toolName)
    if (pending.request.sessionId) {
      void this.logSession(pending.request.sessionId, "tool approval resolved", {
        toolName: pending.request.toolName,
        decision: input.decision,
      })
    }
    pending.resolve({ approved: input.decision !== "deny" })
    return true
  }

  private async loginOAuth(input: LoginOAuthProviderInput) {
    const provider = await this.oauthProvider(input.providerId)
    const credentials = await provider.login({
      onAuth: (info: { url: string; instructions?: string }) => {
        this.options.openExternalUrl?.(info.url)
        this.events?.emit({
          type: "notice",
          payload: { providerId: input.providerId, message: info.instructions ?? "OAuth login opened." },
        })
      },
      onPrompt: async (prompt: OAuthPrompt) => prompt.defaultValue ?? "",
      onProgress: (message: string) => {
        this.events?.emit({ type: "notice", payload: { providerId: input.providerId, message } })
      },
      onServerListening: (info: OAuthServerListeningInfo) => {
        this.events?.emit({
          type: "notice",
          payload: { providerId: input.providerId, message: `Waiting for OAuth callback on ${info.callbackUrl}` },
        })
      },
      onServerClose: () => {
        this.events?.emit({
          type: "notice",
          payload: { providerId: input.providerId, message: "OAuth callback server closed." },
        })
      },
    })

    return saveOAuthCredential(input.apiConnection, {
      providerId: input.providerId,
      label: input.label,
      apiKey: provider.getApiKey(credentials),
      oauthCredentials: toBlameOAuthCredentials(credentials),
      baseUrl: input.baseUrl ?? null,
    })
  }

  private async refreshOAuthCredential(
    connection: ApiConnection,
    credential: Awaited<ReturnType<typeof resolveProviderCredential>>,
    options: { force?: boolean } = {}
  ) {
    if (credential.authMethod !== "oauth" || !credential.oauthCredentials) return credential
    if (!options.force && credential.oauthCredentials.expires > Date.now() + 60_000) return credential

    const provider = await this.oauthProvider(credential.providerId)
    const refreshed = await provider.refreshToken(credential.oauthCredentials)
    const saved = await saveOAuthCredential(connection, {
      providerId: credential.providerId,
      label: credential.label,
      apiKey: provider.getApiKey(refreshed),
      oauthCredentials: toBlameOAuthCredentials(refreshed),
      baseUrl: credential.baseUrl,
    })

    return {
      ...credential,
      apiKey: provider.getApiKey(refreshed),
      oauthCredentials: toBlameOAuthCredentials(refreshed),
      authMethod: saved.authMethod,
    }
  }

  private async syncClineOAuthProviderSettings(
    credential: Awaited<ReturnType<typeof resolveProviderCredential>>
  ) {
    if (credential.authMethod !== "oauth" || !credential.oauthCredentials) return
    if (!supportedClineOAuthProvider(credential.providerId)) return
    const sdk = await import("@cline/sdk")
    const providerId = sdk.normalizeOAuthProvider(credential.providerId)
    const manager = new sdk.ProviderSettingsManager()
    const existing = manager.getProviderSettings(providerId)
    sdk.saveLocalProviderOAuthCredentials(manager, providerId, existing, {
      access: credential.oauthCredentials.access,
      refresh: credential.oauthCredentials.refresh,
      expires: credential.oauthCredentials.expires,
      accountId: credential.oauthCredentials.accountId ?? credential.oauthCredentials.email,
    })
  }

  private async oauthProvider(providerId: string): Promise<OAuthProviderInterface> {
    const sdk = await import("@cline/sdk")
    if (providerId === "openai-codex") return sdk.openaiCodexOAuthProvider
    if (providerId === "cline") {
      return sdk.createClineOAuthProvider({
        apiBaseUrl: "https://api.cline.bot",
      })
    }
    if (providerId === "opencode" || providerId === "oca") return sdk.createOcaOAuthProvider()
    throw new Error(`OAuth is not supported for provider ${providerId}`)
  }

  private emitSessionNotice(sessionId: string, message: string) {
    void this.logSession(sessionId, "notice", { message })
    this.events?.emit({ type: "notice", sessionId, payload: { message } })
  }

  private emitSessionError(sessionId: string, message: string) {
    void this.logSession(sessionId, "error", { message })
    this.events?.emit({ type: "error", sessionId, payload: { message } })
  }

  private async logSession(sessionId: string, message: string, payload?: unknown) {
    const file = this.sessionLogFiles.get(sessionId)
    if (!file) return
    await appendLog(file, message, payload)
  }

  private sendPrompt(cline: ClineCore, sessionId: string, prompt: string) {
    const result = cline.send({ sessionId, prompt }).then((result: unknown) => {
      void this.logSession(sessionId, "send resolved", result)
      const failure = resultFailureMessage(result)
      if (failure) {
        this.emitSessionError(sessionId, failure)
        return result
      }
      this.events?.emit({ type: "done", sessionId, payload: result })
      return result
    }).catch((error: unknown) => {
      const message = errorMessage(error)
      void this.logSession(sessionId, "send failed", { message })
      this.emitSessionError(sessionId, message)
      throw error
    })
    void this.logSession(sessionId, "prompt sent", {
      promptLength: prompt.length,
      promptPreview: prompt.slice(0, 500),
    })
    return result
  }
}

function normalizeEvent(sessionId: string, event: CoreSessionEvent): AgentEvent {
  if (event.type === "chunk") {
    const parsed = parseChunkEvent(event.payload.chunk)
    if (event.payload.stream === "agent" && parsed) {
      return normalizeClineAgentPayload(parsed, event.payload.sessionId, parsed)
    }
    return {
      type: event.payload.stream === "agent" ? "text" : "notice",
      sessionId: event.payload.sessionId,
      payload: { text: event.payload.chunk, stream: event.payload.stream, ts: event.payload.ts },
    }
  }
  if (event.type === "hook") return normalizeHookEvent(event, sessionId)
  if (event.type === "ended") return { type: "done", sessionId: event.payload.sessionId, payload: event.payload }
  if (event.type === "status") return { type: "notice", sessionId: event.payload.sessionId, payload: event.payload }
  if (event.type === "agent_event") return normalizeAgentEvent(event, sessionId)
  return { type: "raw", sessionId, payload: event }
}

function toolPolicies(autoApproveWriteTools: boolean) {
  return Object.fromEntries([
    ...readTools.map((name) => [name, { autoApprove: true }]),
    ...writeTools.map((name) => [name, { autoApprove: autoApproveWriteTools }]),
  ])
}

function initializationConfig(
  input: InitializeProjectInput,
  credential: { apiKey: string; baseUrl: string | null }
) {
  return {
    providerId: input.providerId,
    modelId: input.modelId,
    apiKey: credential.apiKey,
    baseUrl: credential.baseUrl ?? undefined,
    thinking: !!input.reasoningEffort,
    reasoningEffort: input.reasoningEffort,
    systemPrompt:
      "You are Blame project initialization analyst. Return strict JSON only.",
    cwd: input.cwd,
    workspaceRoot: input.workspaceRoot,
    enableTools: true,
    enableSpawnAgent: false,
    enableAgentTeams: false,
    maxIterations: 8,
  }
}

function initializationPrompt(scan: ProjectInitializationScan, correction?: InitializationCorrection) {
  if (!correction) return projectInitializationPrompt(scan)
  return projectInitializationCorrectionPrompt(scan, correction)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function forceOAuthRefresh(providerId: string) {
  return providerId === "openai-codex"
}

function supportedClineOAuthProvider(providerId: string) {
  return providerId === "openai-codex" || providerId === "cline" || providerId === "opencode" || providerId === "oca"
}

function startContext(input: StartSessionInput) {
  return {
    providerId: input.providerId,
    modelId: input.modelId,
    reasoningEffort: input.reasoningEffort,
    cwd: input.cwd,
    workspaceRoot: input.workspaceRoot,
    mode: input.mode ?? "act",
    maxIterations: input.maxIterations ?? 32,
    autoApproveWriteTools: !!input.autoApproveWriteTools,
    autoSendPrompt: input.autoSendPrompt !== false,
    promptLength: input.prompt.length,
  }
}

function startLogPath(cwd: string) {
  return join(cwd, ".blame", "logs", "cline-start.log")
}

function sessionLogPath(cwd: string, sessionId: string) {
  return join(cwd, ".blame", "logs", `cline-${sessionId}.log`)
}

async function appendLog(file: string, message: string, payload?: unknown) {
  try {
    await mkdir(dirname(file), { recursive: true })
    await appendFile(file, `${JSON.stringify(logLine(message, payload))}\n`, "utf8")
  } catch (error) {
    console.warn("[blame-agent] failed to write log", file, error)
  }
}

function logLine(message: string, payload?: unknown) {
  return {
    ts: new Date().toISOString(),
    message,
    payload,
  }
}

function resultFailureMessage(result: unknown) {
  const payload = asRecord(result)
  const status = stringValue(payload.status) ?? stringValue(payload.state)
  if (!status || !["failed", "error", "cancelled"].includes(status)) return undefined
  return stringValue(payload.error) ?? stringValue(payload.message) ?? `Cline send ended with status ${status}.`
}

function initializationToolPolicies() {
  return Object.fromEntries([
    ...readTools.map((name) => [name, { autoApprove: true }]),
    ...writeTools.map((name) => [name, { enabled: false, autoApprove: false }]),
  ])
}

function normalizeHookEvent(event: Extract<CoreSessionEvent, { type: "hook" }>, fallbackSessionId: string): AgentEvent {
  const type = event.payload.hookEventName === "agent_error" ? "error" : "tool"
  return {
    type,
    sessionId: event.payload.sessionId ?? fallbackSessionId,
    payload: event.payload,
  }
}

function normalizeAgentEvent(event: Extract<CoreSessionEvent, { type: "agent_event" }>, fallbackSessionId: string): AgentEvent {
  const payload = asRecord(event.payload.event)
  return normalizeClineAgentPayload(payload, event.payload.sessionId ?? fallbackSessionId, event.payload.event)
}

function normalizeClineAgentPayload(payload: Record<string, unknown>, sessionId: string, raw: unknown): AgentEvent {
  const type = stringValue(payload.type)

  if (type === "content_start" || type === "content_update") {
    return normalizeContentEvent(payload, sessionId, raw)
  }

  if (type === "content_end") {
    return normalizeContentEndEvent(payload, sessionId, raw)
  }

  if (type === "done") {
    return {
      type: "done",
      sessionId,
      payload: {
        reason: stringValue(payload.reason),
        text: stringValue(payload.text),
        usage: payload.usage,
        raw,
      },
    }
  }

  if (type === "usage") {
    return {
      type: "usage",
      sessionId,
      payload: { usage: payload, raw },
    }
  }

  if (type === "iteration_start" || type === "iteration_end") {
    return {
      type: "notice",
      sessionId,
      payload: {
        message: type === "iteration_start" ? "Agent iteration started." : "Agent iteration completed.",
        iteration: numberValue(payload.iteration),
        raw,
      },
    }
  }

  if (type === "assistant-reasoning-delta") {
    return {
      type: "reasoning",
      sessionId,
      payload: {
        text: stringValue(payload.text) ?? "",
        accumulatedText: stringValue(payload.accumulatedText),
        iteration: numberValue(payload.iteration),
        raw,
      },
    }
  }

  if (type === "assistant-text-delta") {
    return {
      type: "text",
      sessionId,
      payload: {
        text: stringValue(payload.text) ?? "",
        accumulatedText: stringValue(payload.accumulatedText),
        iteration: numberValue(payload.iteration),
        raw,
      },
    }
  }

  if (type === "tool-started" || type === "tool-updated" || type === "tool-finished") {
    return {
      type: "tool",
      sessionId,
      payload: {
        phase: type.replace("tool-", ""),
        iteration: numberValue(payload.iteration),
        toolCall: payload.toolCall,
        update: payload.update,
        raw,
      },
    }
  }

  if (type === "usage-updated") {
    return {
      type: "usage",
      sessionId,
      payload: { usage: payload.usage, raw },
    }
  }

  if (type === "status-notice") {
    return {
      type: "notice",
      sessionId,
      payload: {
        message: stringValue(payload.message) ?? "Agent status updated.",
        metadata: payload.metadata,
        raw,
      },
    }
  }

  if (type === "run-finished") {
    const result = asRecord(payload.result)
    return {
      type: "done",
      sessionId,
      payload: {
        text: stringValue(result.outputText),
        status: stringValue(result.status),
        raw,
      },
    }
  }

  if (type === "run-failed") {
    const error = asRecord(payload.error)
    return {
      type: "error",
      sessionId,
      payload: {
        message: stringValue(error.message) ?? "Agent session failed",
        raw,
      },
    }
  }

  const text = stringValue(payload.text) ?? stringValue(payload.content) ?? stringValue(payload.delta)

  if (text) {
    return {
      type: "text",
      sessionId,
      payload: { text, raw },
    }
  }

  return {
    type: "raw",
    sessionId,
    payload,
  }
}

function normalizeContentEvent(payload: Record<string, unknown>, sessionId: string, raw: unknown): AgentEvent {
  const contentType = stringValue(payload.contentType)
  if (contentType === "tool") {
    return {
      type: "tool",
      sessionId,
      payload: {
        phase: "started",
        toolCall: {
          id: stringValue(payload.toolCallId),
          name: stringValue(payload.toolName),
          input: payload.input,
        },
        raw,
      },
    }
  }
  if (contentType === "reasoning" || contentType === "thinking") {
    return {
      type: "reasoning",
      sessionId,
      payload: {
        text: stringValue(payload.reasoning) ?? stringValue(payload.text) ?? "",
        accumulatedText: stringValue(payload.accumulated) ?? stringValue(payload.reasoning),
        redacted: booleanValue(payload.redacted),
        raw,
      },
    }
  }
  return {
    type: "text",
    sessionId,
    payload: {
      text: stringValue(payload.text) ?? "",
      accumulatedText: stringValue(payload.accumulated),
      raw,
    },
  }
}

function normalizeContentEndEvent(payload: Record<string, unknown>, sessionId: string, raw: unknown): AgentEvent {
  if (stringValue(payload.contentType) === "tool") {
    return {
      type: "tool",
      sessionId,
      payload: {
        durationMs: numberValue(payload.durationMs),
        output: payload.output,
        phase: "finished",
        toolCall: {
          id: stringValue(payload.toolCallId),
          name: stringValue(payload.toolName),
          input: payload.input,
        },
        raw,
      },
    }
  }
  return normalizeContentEvent(payload, sessionId, raw)
}

function toApprovalRequest(request: ToolApprovalRequest, toolName: string): AgentApprovalRequest {
  return {
    id: randomUUID(),
    sessionId: request.sessionId,
    toolName,
    reason: request.reason,
    input: request.input,
  }
}

function runtimeLogger() {
  return {
    log: (...input: unknown[]) => console.log("[blame-agent]", ...input),
    debug: (...input: unknown[]) => console.debug("[blame-agent]", ...input),
    info: (...input: unknown[]) => console.info("[blame-agent]", ...input),
    warn: (...input: unknown[]) => console.warn("[blame-agent]", ...input),
    error: (...input: unknown[]) => console.error("[blame-agent]", ...input),
  }
}

function asRecord(value: unknown) {
  if (value && typeof value === "object") return value as Record<string, unknown>
  return {}
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : undefined
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : undefined
}

function parseChunkEvent(value: string) {
  try {
    const parsed = JSON.parse(value)
    return asRecord(parsed)
  } catch {
    return undefined
  }
}

function toBlameOAuthCredentials(credentials: ClineOAuthCredentials): OAuthCredentials {
  return {
    access: credentials.access,
    refresh: credentials.refresh,
    expires: credentials.expires,
    accountId: credentials.accountId,
    email: credentials.email,
    metadata: credentials.metadata,
  }
}
