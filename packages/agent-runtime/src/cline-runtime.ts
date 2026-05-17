import { randomUUID } from "node:crypto"

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
import type {
  AgentApprovalRequest,
  AgentEvent,
  AgentRuntimeEvents,
  ApiConnection,
  LoginOAuthProviderInput,
  OAuthCredentials,
  ResolveApprovalInput,
  SaveProviderCredentialInput,
  SendSessionInput,
  StartSessionInput,
} from "./types.js"

const readTools = ["read_files", "search_codebase", "fetch_web_content"]
const writeTools = ["run_commands", "editor", "apply_patch"]

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

type RuntimeOptions = {
  openExternalUrl?(url: string): void
}

export class BlameAgentRuntime {
  private cline?: Promise<ClineCore>
  private unsubscribers = new Map<string, () => void>()
  private pendingApprovals = new Map<string, PendingApproval>()
  private alwaysAllowedTools = new Set<string>()
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

  private async core() {
    if (!this.cline) {
      this.cline = import("@cline/sdk").then((module) =>
        module.ClineCore.create({
          clientName: "blame",
          backendMode: "auto",
          toolPolicies: toolPolicies(),
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
    const credential = await resolveProviderCredential(input.apiConnection, {
      providerId: input.providerId,
      label: input.credentialLabel,
    })
    const resolvedCredential = await this.refreshOAuthCredential(input.apiConnection, credential)
    const cline = await this.core()
    const session = await cline.start({
      prompt: input.prompt,
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
        enableTools: true,
        enableSpawnAgent: false,
        enableAgentTeams: false,
      },
      interactive: true,
      source: "blame-desktop",
      toolPolicies: toolPolicies(),
    })
    await this.subscribeSession(session.sessionId)
    return session
  }

  private async sendSession(input: SendSessionInput) {
    const cline = await this.core()
    return cline.send(input)
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

  private async subscribeSession(sessionId: string) {
    this.unsubscribeSession(sessionId)
    const cline = await this.core()
    const unsubscribe = await cline.subscribe((payload: CoreSessionEvent) => {
      this.events?.emit(normalizeEvent(sessionId, payload))
    }, { sessionId })
    this.unsubscribers.set(sessionId, unsubscribe)
  }

  private unsubscribeSession(sessionId: string) {
    this.unsubscribers.get(sessionId)?.()
    this.unsubscribers.delete(sessionId)
  }

  private requestApproval(request: ToolApprovalRequest): Promise<ToolApprovalResult> | ToolApprovalResult {
    const toolName = request.toolName ?? request.name ?? "unknown"
    if (!writeTools.includes(toolName) || this.alwaysAllowedTools.has(toolName)) return { approved: true }

    return new Promise((resolve) => {
      const approval = toApprovalRequest(request, toolName)
      this.pendingApprovals.set(approval.id, { request: approval, resolve })
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
    credential: Awaited<ReturnType<typeof resolveProviderCredential>>
  ) {
    if (credential.authMethod !== "oauth" || !credential.oauthCredentials) return credential
    if (credential.oauthCredentials.expires > Date.now() + 60_000) return credential

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
}

function normalizeEvent(sessionId: string, event: CoreSessionEvent): AgentEvent {
  if (event.type === "chunk") {
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

function toolPolicies() {
  return Object.fromEntries([
    ...readTools.map((name) => [name, { autoApprove: true }]),
    ...writeTools.map((name) => [name, { autoApprove: false }]),
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
  const text = stringValue(payload.text) ?? stringValue(payload.content) ?? stringValue(payload.delta)

  if (text) {
    return {
      type: "text",
      sessionId: event.payload.sessionId ?? fallbackSessionId,
      payload: { text, raw: event.payload.event },
    }
  }

  return {
    type: "raw",
    sessionId: event.payload.sessionId ?? fallbackSessionId,
    payload: event.payload,
  }
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
