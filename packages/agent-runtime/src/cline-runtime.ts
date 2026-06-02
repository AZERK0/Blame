import { randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { appendFile, mkdir, rm } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { promisify } from "node:util"

import type {
  ClineCore,
  CoreSessionEvent,
  OAuthCredentials as ClineOAuthCredentials,
  OAuthPrompt,
  OAuthProviderInterface,
  OAuthServerListeningInfo,
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
import { optimizeUserStoryPrompt } from "./prompt-optimization.js"
import { loadPrompt } from "./prompt-loader.js"
import {
  appendProductionConfig,
  assertRepositoryPath,
  assertWorkspacePath,
  createProductionLogger,
  createProductionTelemetry,
  loadProductionConfig,
  promptMetadata,
  recordUsageTelemetry,
  safeLogPayload,
  shouldAbortForUsage,
  summarizeUsage,
  usageLimitMessage,
} from "./production.js"
import type { ProjectInitializationScan } from "./project-initialization.js"
import type { ProductionSessionContext } from "./production.js"
import type {
  AgentApprovalRequest,
  AgentEvent,
  AgentRuntimeEvents,
  AgentUsageSummary,
  ApiConnection,
  ApproveAndMergeInput,
  ApproveAndMergeResult,
  InitializeProjectInput,
  InitializeProjectResult,
  LoginOAuthProviderInput,
  OAuthCredentials,
  OptimizeUserStoryPromptInput,
  OptimizeUserStoryPromptResult,
  ProjectCodePracticeKey,
  ProjectCodePracticePreference,
  ResolveApprovalInput,
  SaveProviderCredentialInput,
  SendDevelopmentSessionInput,
  SendSessionInput,
  StartDevelopmentSessionInput,
  StartSessionInput,
} from "./types.js"

const execFileAsync = promisify(execFile)
const readTools = ["read_files", "search_codebase", "fetch_web_content"]
const writeTools = ["run_commands", "editor", "apply_patch"]
const blockedCommandParts = ["rm -rf", "sudo", "curl | sh", "wget | sh", "> /dev/"]
const defaultSessionMaxIterations = 32
const defaultDevelopmentMaxIterations = 96
const maxInitializationAttempts = 3
const maxMergeConflictResolutionAttempts = 3
const runtimeArtifactPathspecs = [":!.blame", ":!.blame-preview", ":!.pnpm-store"]
const productionLogger = createProductionLogger()
const openAICompatibleProviderID = "openai-compatible"

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

type RuntimeCredentialInput = {
  apiConnection: ApiConnection
  providerId: string
  modelId?: string
  credentialLabel?: string
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
  private telemetryHandle?: Promise<Awaited<ReturnType<typeof createProductionTelemetry>>>
  private unsubscribers = new Map<string, () => void>()
  private pendingApprovals = new Map<string, PendingApproval>()
  private alwaysAllowedTools = new Set<string>()
  private autoApprovedWriteToolSessions = new Set<string>()
  private sessionLogFiles = new Map<string, string>()
  private sessionContexts = new Map<string, ProductionSessionContext>()
  private readonly productionConfig = loadProductionConfig()
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
    startDevelopment: (input: StartDevelopmentSessionInput) => this.startDevelopmentSession(input),
    send: (input: SendSessionInput) => this.sendSession(input),
    sendDevelopment: (input: SendDevelopmentSessionInput) => this.sendDevelopmentSession(input),
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

  promptOptimizer = {
    optimizeUserStory: (input: OptimizeUserStoryPromptInput) => this.optimizeUserStoryPrompt(input),
  }

  approveAndMerge = (input: ApproveAndMergeInput) => this.approveAndMergeStory(input)

  async shutdown() {
    const sessionIds = await this.activeSessionIds()
    await Promise.allSettled(sessionIds.map((sessionId) => this.abortSession(sessionId)))
    sessionIds.forEach((sessionId) => this.unsubscribeSession(sessionId))
    this.resolvePendingApprovals()
    this.sessionLogFiles.clear()
    this.sessionContexts.clear()
    await this.disposeCore()
    await this.disposeTelemetry()
  }

  private async core() {
    if (!this.cline) {
      this.cline = Promise.all([import("@cline/sdk"), this.telemetry()]).then(([module, telemetry]) =>
        module.ClineCore.create({
          clientName: "blame",
          backendMode: "auto",
          toolPolicies: toolPolicies(false),
          capabilities: {
            requestToolApproval: (request: ToolApprovalRequest) => this.requestApproval(request),
          },
          logger: productionLogger,
          telemetry: telemetry?.telemetry,
        })
      )
    }
    return this.cline
  }

  private telemetry() {
    if (!this.telemetryHandle) {
      this.telemetryHandle = createProductionTelemetry(productionLogger)
    }
    return this.telemetryHandle
  }

  private async startSession(input: StartSessionInput) {
    assertWorkspacePath(input.cwd, input.workspaceRoot, "cwd")
    const startLogFile = startLogPath(input.cwd)
    await appendLog(startLogFile, "start requested", startContext(input))
    const startedAt = Date.now()
    try {
      const credential = await resolveProviderCredential(input.apiConnection, {
        providerId: input.providerId,
        label: credentialLabel(input),
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
          ...appendProductionConfig({
            providerId: input.providerId,
            modelId: input.modelId,
            apiKey: resolvedCredential.apiKey,
            baseUrl: resolvedCredential.baseUrl ?? undefined,
            thinking: !!input.reasoningEffort,
            reasoningEffort: input.reasoningEffort,
            systemPrompt: input.systemPrompt ?? loadPrompt("default-agent-system"),
            cwd: input.cwd,
            workspaceRoot: input.workspaceRoot,
            mode: input.mode ?? "act",
            maxIterations: input.maxIterations ?? defaultSessionMaxIterations,
            enableTools: true,
            enableSpawnAgent: false,
            enableAgentTeams: false,
          }),
        },
        interactive: true,
        source: "blame-desktop",
        toolPolicies: toolPolicies(!!input.autoApproveWriteTools),
      })
      const sessionLogFile = sessionLogPath(input.cwd, session.sessionId)
      this.sessionLogFiles.set(session.sessionId, sessionLogFile)
      this.sessionContexts.set(session.sessionId, sessionContext(input, session.sessionId))
      await appendLog(startLogFile, "session created", {
        durationMs: Date.now() - startedAt,
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
          ...promptMetadata(input.prompt),
        })
      }
      return session
    } catch (error) {
      await appendLog(startLogFile, "start failed", {
        durationMs: Date.now() - startedAt,
        errorType: errorType(error),
        message: errorMessage(error),
        status: "failed",
      })
      throw error
    }
  }

  private async sendSession(input: SendSessionInput) {
    const cline = await this.core()
    return this.sendPrompt(cline, input.sessionId, input.prompt)
  }

  private sendDevelopmentSession(input: SendDevelopmentSessionInput) {
    return this.sendSession({
      sessionId: input.sessionId,
      prompt: developmentStoryPrompt(input),
    })
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

  private async readUsage(sessionId: string): Promise<AgentUsageSummary | undefined> {
    const cline = await this.core()
    return cline.getAccumulatedUsage(sessionId)
  }

  private async initializeProject(input: InitializeProjectInput): Promise<InitializeProjectResult> {
    assertWorkspacePath(input.cwd, input.workspaceRoot, "cwd")
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

  private async optimizeUserStoryPrompt(
    input: OptimizeUserStoryPromptInput
  ): Promise<OptimizeUserStoryPromptResult> {
    assertWorkspacePath(input.cwd, input.workspaceRoot, "cwd")
    const prompt = input.prompt.trim()
    if (!prompt) throw new Error("Prompt optimizer requires a user story prompt.")
    const credential = await this.runtimeCredential(input)
    const cline = await this.core()
    return optimizeUserStoryPrompt({ ...input, prompt }, cline, credential)
  }

  private async initializationCredential(input: InitializeProjectInput) {
    return this.runtimeCredential(input)
  }

  private async runtimeCredential(input: RuntimeCredentialInput) {
    const credential = await resolveProviderCredential(input.apiConnection, {
      providerId: input.providerId,
      label: credentialLabel(input),
    })
    return this.refreshOAuthCredential(input.apiConnection, credential)
  }

  private async approveAndMergeStory(input: ApproveAndMergeInput): Promise<ApproveAndMergeResult> {
    assertRepositoryPath(input.repositoryRoot, "repositoryRoot")
    assertRepositoryPath(input.worktree, "worktree")
    const logFile = approveMergeLogPath(input.worktree)
    await appendLog(logFile, "approve merge requested", approveMergeContext(input))
    await assertGitRepository(input.repositoryRoot)
    await assertGitRepository(input.worktree)
    const targetBranch = await currentGitBranch(input.repositoryRoot)
    await validateMergeBranches(input, targetBranch)
    const upstream = await gitUpstream(input.repositoryRoot)
    const targetClean = await cleanGitStatus(input.repositoryRoot)
    const integration = targetClean
      ? input.repositoryRoot
      : await integrationWorktree(input.repositoryRoot, targetBranch)
    await pullIntegrationWorktree(integration, upstream)
    await this.commitStoryWork(input)
    await this.mergeTargetIntoStory(input, targetBranch, upstream)
    try {
      await git(integration, ["merge", "--ff-only", input.storyBranch])
      const mergeCommit = await git(integration, ["rev-parse", "HEAD"])
      await git(integration, ["push", upstream.remote, `HEAD:${upstream.branch}`])
      await appendLog(logFile, "approve merge completed", { mergeCommit, targetBranch })
      return { mergeCommit, targetBranch }
    } finally {
      if (!targetClean) {
        await removeIntegrationWorktree(input.repositoryRoot, integration)
      }
    }
  }

  private async commitStoryWork(input: ApproveAndMergeInput) {
    const status = await storyStatus(input.worktree, "--porcelain")
    if (!status.trim()) return
    const message = await this.generateCommitMessage(input, approveMergeLogPath(input.worktree))
    await addStoryChanges(input.worktree)
    await git(input.worktree, ["commit", "-m", message])
    const nextStatus = await storyStatus(input.worktree, "--porcelain")
    if (nextStatus.trim()) throw new Error("Story worktree still has uncommitted changes after commit.")
  }

  private async generateCommitMessage(input: ApproveAndMergeInput, logFile: string) {
    try {
      const startedAt = Date.now()
      const credential = await this.runtimeCredential(input)
      const cline = await this.core()
      const session = await cline.start({
        prompt: await commitMessagePrompt(input),
        config: commitMessageConfig(input, credential),
        interactive: false,
        source: "blame-approve-merge",
        toolPolicies: initializationToolPolicies(),
      })
      const message = commitMessageFromAgentResult(session.result)
      await appendLog(logFile, "commit message agent finished", {
        durationMs: Date.now() - startedAt,
        sessionId: session.sessionId,
        status: resultStatus(asRecord(session.result)),
        success: Boolean(message),
      })
      if (message) return message
    } catch (error) {
      await appendLog(logFile, "commit message agent failed", {
        errorType: errorType(error),
        status: "failed",
      })
    }
    await appendLog(logFile, "commit message fallback selected", { status: "fallback", success: true })
    return fallbackCommitMessage(input)
  }

  private async mergeTargetIntoStory(input: ApproveAndMergeInput, targetBranch: string, upstream: GitUpstream) {
    await git(input.worktree, ["fetch", upstream.remote, upstream.branch])
    try {
      await git(input.worktree, ["merge", `${upstream.remote}/${upstream.branch}`])
      return
    } catch (error) {
      if (!(await hasMergeConflicts(input.worktree))) throw error
    }
    await this.resolveMergeConflicts(input, targetBranch, approveMergeLogPath(input.worktree))
    const conflicts = await mergeConflictFiles(input.worktree)
    if (conflicts.length) throw new Error(unresolvedMergeConflictMessage(conflicts))
    await addStoryChanges(input.worktree)
    await git(input.worktree, ["commit", "--no-edit"])
  }

  private async resolveMergeConflicts(input: ApproveAndMergeInput, targetBranch: string, logFile: string) {
    let conflicts = await mergeConflictFiles(input.worktree)
    for (let attempt = 1; attempt <= maxMergeConflictResolutionAttempts && conflicts.length; attempt += 1) {
      const failure = await this.runMergeConflictAgent(input, targetBranch, attempt, logFile)
      conflicts = await mergeConflictFiles(input.worktree)
      await appendLog(logFile, "merge conflict agent finished", {
        status: conflicts.length ? "conflicts_remaining" : "resolved",
        success: !conflicts.length,
      })
      if (failure && conflicts.length) throw new Error(failure)
    }
    if (conflicts.length) throw new Error(unresolvedMergeConflictMessage(conflicts))
  }

  private async runMergeConflictAgent(
    input: ApproveAndMergeInput,
    targetBranch: string,
    attempt: number,
    logFile: string
  ) {
    const startedAt = Date.now()
    const credential = await this.runtimeCredential(input)
    const cline = await this.core()
    const session = await cline.start({
      prompt: await mergeConflictPrompt(input, targetBranch, attempt),
      config: mergeConflictConfig(input, credential),
      interactive: false,
      source: "blame-merge-conflict-resolution",
      toolPolicies: toolPolicies(true),
    })
    await appendLog(logFile, "merge conflict agent run completed", {
      durationMs: Date.now() - startedAt,
      sessionId: session.sessionId,
      status: resultStatus(asRecord(session.result)),
    })
    return resultFailureMessage(session.result)
  }

  private async subscribeSession(sessionId: string) {
    this.unsubscribeSession(sessionId)
    const cline = await this.core()
    const unsubscribe = await cline.subscribe((payload: CoreSessionEvent) => {
      const event = normalizeEvent(sessionId, payload)
      void this.handleSessionEvent(sessionId, event)
      this.events?.emit(event)
    }, { sessionId })
    this.unsubscribers.set(sessionId, unsubscribe)
  }

  private async handleSessionEvent(sessionId: string, event: AgentEvent) {
    await this.logSession(sessionId, `event:${event.type}`, eventLogPayload(event))
    if (event.type !== "usage") return
    const usage = await this.readUsage(sessionId)
    const context = this.sessionContexts.get(sessionId) ?? { sessionId }
    await this.logSession(sessionId, "usage updated", { ...context, ...summarizeUsage(usage) })
    recordUsageTelemetry((await this.telemetry())?.telemetry, usage, context)
    if (!shouldAbortForUsage(usage, this.productionConfig)) return
    const message = usageLimitMessage(usage, this.productionConfig)
    this.emitSessionError(sessionId, message)
    await this.abortSession(sessionId)
  }

  private unsubscribeSession(sessionId: string) {
    this.unsubscribers.get(sessionId)?.()
    this.unsubscribers.delete(sessionId)
    this.autoApprovedWriteToolSessions.delete(sessionId)
    this.sessionContexts.delete(sessionId)
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
    const blockedReason = blockedToolReason(toolName, request.input)
    if (blockedReason) {
      if (request.sessionId) this.emitSessionError(request.sessionId, blockedReason)
      return { approved: false }
    }
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

  private async disposeCore() {
    if (!this.cline) return
    const cline = await this.cline
    await cline.dispose("Shutting down")
    this.cline = undefined
  }

  private async disposeTelemetry() {
    const telemetry = await this.telemetryHandle
    await telemetry?.flush()
    await telemetry?.dispose()
    this.telemetryHandle = undefined
  }

  private startDevelopmentSession(input: StartDevelopmentSessionInput) {
    return this.startSession({
      apiConnection: input.apiConnection,
      providerId: input.providerId,
      modelId: input.modelId,
      reasoningEffort: input.reasoningEffort,
      autoApproveWriteTools: true,
      autoSendPrompt: false,
      mode: "act",
      maxIterations: input.maxIterations ?? developmentMaxIterations(),
      prompt: developmentStoryPrompt(input),
      cwd: input.cwd,
      workspaceRoot: input.workspaceRoot,
      systemPrompt: developmentSystemPrompt(input.codePractices),
    })
  }

  private sendPrompt(cline: ClineCore, sessionId: string, prompt: string) {
    const startedAt = Date.now()
    const result = cline.send({ sessionId, prompt }).then((result: unknown) => {
      void this.logSession(sessionId, "send resolved", sendResultLogPayload(result, Date.now() - startedAt))
      const failure = resultFailureMessage(result)
      if (failure) {
        this.emitSessionError(sessionId, failure)
        return result
      }
      this.events?.emit({ type: "done", sessionId, payload: result })
      return result
    }).catch((error: unknown) => {
      const message = errorMessage(error)
      void this.logSession(sessionId, "send failed", {
        durationMs: Date.now() - startedAt,
        errorType: errorType(error),
        message,
        status: "failed",
      })
      this.emitSessionError(sessionId, message)
      throw error
    })
    void this.logSession(sessionId, "prompt sent", {
      ...promptMetadata(prompt),
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
  return appendProductionConfig({
    providerId: input.providerId,
    modelId: input.modelId,
    apiKey: credential.apiKey,
    baseUrl: credential.baseUrl ?? undefined,
    thinking: !!input.reasoningEffort,
    reasoningEffort: input.reasoningEffort,
    systemPrompt: loadPrompt("project-initialization-system"),
    cwd: input.cwd,
    workspaceRoot: input.workspaceRoot,
    enableTools: true,
    enableSpawnAgent: false,
    enableAgentTeams: false,
    maxIterations: 8,
  })
}

function commitMessageConfig(
  input: ApproveAndMergeInput,
  credential: { apiKey: string; baseUrl: string | null }
) {
  return appendProductionConfig({
    providerId: input.providerId,
    modelId: input.modelId,
    apiKey: credential.apiKey,
    baseUrl: credential.baseUrl ?? undefined,
    thinking: !!input.reasoningEffort,
    reasoningEffort: input.reasoningEffort,
    systemPrompt: developmentPracticePrompt(input.codePractices ?? [], "commit_message_convention"),
    cwd: input.worktree,
    workspaceRoot: input.worktree,
    enableTools: false,
    enableSpawnAgent: false,
    enableAgentTeams: false,
    maxIterations: 4,
  })
}

function mergeConflictConfig(
  input: ApproveAndMergeInput,
  credential: { apiKey: string; baseUrl: string | null }
) {
  return appendProductionConfig({
    providerId: input.providerId,
    modelId: input.modelId,
    apiKey: credential.apiKey,
    baseUrl: credential.baseUrl ?? undefined,
    thinking: !!input.reasoningEffort,
    reasoningEffort: input.reasoningEffort,
    systemPrompt: loadPrompt("merge-conflict-resolution"),
    cwd: input.worktree,
    workspaceRoot: input.worktree,
    enableTools: true,
    enableSpawnAgent: false,
    enableAgentTeams: false,
    maxIterations: 24,
  })
}

function initializationPrompt(scan: ProjectInitializationScan, correction?: InitializationCorrection) {
  if (!correction) return projectInitializationPrompt(scan)
  return projectInitializationCorrectionPrompt(scan, correction)
}

function developmentStoryPrompt(input: Pick<StartDevelopmentSessionInput, "feedback" | "summary" | "title">) {
  const prompt = [
    `Backlog item: ${input.title}`,
    "",
    input.summary,
  ]
  if (input.feedback?.trim()) {
    prompt.push("", "Review feedback:", "", input.feedback.trim())
  }
  prompt.push(
    "",
    "Work in the current worktree when code changes are clearly required.",
    "If the request is a question, analysis, opinion, explanation, or review request, inspect the project if useful and answer in Markdown without editing files.",
    "Only modify files when the request explicitly asks for implementation or when a concrete code change is necessary to satisfy it."
  )
  return prompt.join("\n")
}

function developmentSystemPrompt(practices: ProjectCodePracticePreference[] = []) {
  return [
    loadPrompt("code-agent-system"),
    developmentPracticePrompt(practices, "coding_style"),
    developmentPracticePrompt(practices, "layered_architecture"),
    developmentPracticePrompt(practices, "unit_tests"),
  ].join("\n\n")
}

function developmentPracticePrompt(
  practices: ProjectCodePracticePreference[],
  practice: ProjectCodePracticeKey
) {
  const enabled = practices.find((item) => item.practice === practice)?.enabled
  if (practice === "coding_style") {
    return loadPrompt(`practices/coding-style/${enabled ? "standard" : "match-codebase"}`)
  }
  if (practice === "layered_architecture") {
    return loadPrompt(`practices/architecture/${enabled ? "standard" : "match-codebase"}`)
  }
  if (practice === "commit_message_convention") {
    return loadPrompt(`practices/commit-message/${enabled ? "standard" : "match-codebase"}`)
  }
  return loadPrompt(`practices/unit-tests/${enabled ? "standard" : "disabled"}`)
}

async function assertGitRepository(cwd: string) {
  await git(cwd, ["rev-parse", "--show-toplevel"])
}

async function currentGitBranch(cwd: string) {
  return git(cwd, ["branch", "--show-current"])
}

async function validateMergeBranches(input: ApproveAndMergeInput, targetBranch: string) {
  if (!targetBranch) throw new Error("Unable to detect the active project branch.")
  const storyBranch = await currentGitBranch(input.worktree)
  if (storyBranch !== input.storyBranch) {
    throw new Error(`Story worktree is on ${storyBranch}, expected ${input.storyBranch}.`)
  }
  if (targetBranch === input.storyBranch) {
    throw new Error("Story branch and target branch must be different.")
  }
}

async function gitUpstream(cwd: string) {
  try {
    const upstream = await git(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
    return parseUpstream(upstream)
  } catch {
    throw new Error("Active project branch has no upstream configured.")
  }
}

async function cleanGitStatus(cwd: string) {
  const status = await git(cwd, ["status", "--porcelain"])
  return !status.trim()
}

async function integrationWorktree(cwd: string, targetBranch: string) {
  const directory = integrationWorktreePath(cwd, targetBranch)
  await rm(directory, { force: true, recursive: true })
  await git(cwd, ["worktree", "add", "--detach", directory, targetBranch])
  return directory
}

async function pullIntegrationWorktree(cwd: string, upstream: GitUpstream) {
  await git(cwd, ["fetch", upstream.remote, upstream.branch])
  await git(cwd, ["merge", "--ff-only", `${upstream.remote}/${upstream.branch}`])
}

async function removeIntegrationWorktree(repositoryRoot: string, worktree: string) {
  try {
    await git(repositoryRoot, ["worktree", "remove", "--force", worktree])
  } catch {
    await rm(worktree, { force: true, recursive: true })
    await git(repositoryRoot, ["worktree", "prune"]).catch(() => undefined)
  }
}

type GitUpstream = {
  branch: string
  remote: string
}

function parseUpstream(value: string): GitUpstream {
  const [remote, ...branchParts] = value.split("/")
  const branch = branchParts.join("/")
  if (!remote || !branch) throw new Error("Active project branch upstream is invalid.")
  return { branch, remote }
}

function integrationWorktreePath(repositoryRoot: string, targetBranch: string) {
  return join(
    dirname(repositoryRoot),
    ".blame-worktrees",
    basename(repositoryRoot),
    ".merge",
    branchPathSlug(targetBranch)
  )
}

function branchPathSlug(branch: string) {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "target"
}

async function hasMergeConflicts(cwd: string) {
  return Boolean((await mergeConflictFiles(cwd)).length)
}

async function mergeConflictFiles(cwd: string) {
  const files = await git(cwd, ["diff", "--name-only", "--diff-filter=U"])
  return files.split("\n").filter(Boolean)
}

async function commitMessagePrompt(input: ApproveAndMergeInput) {
  const [status, diff, log] = await Promise.all([
    storyStatus(input.worktree, "--porcelain"),
    git(input.worktree, ["diff", "--no-ext-diff", "HEAD", "--"]),
    git(input.worktree, ["log", "-12", "--pretty=%s"]),
  ])
  return [
    `Backlog item: ${input.title}`,
    "",
    input.summary,
    "",
    `Git status:\n${truncateText(status, 8_000)}`,
    "",
    `Recent commits:\n${truncateText(log, 8_000)}`,
    "",
    `Diff:\n${truncateText(diff, 60_000)}`,
  ].join("\n")
}

async function fallbackCommitMessage(input: ApproveAndMergeInput) {
  const [status, log] = await Promise.all([
    storyStatus(input.worktree, "--porcelain"),
    git(input.worktree, ["log", "-12", "--pretty=%s"]),
  ])
  const files = statusFileNames(status)
  const subject = fallbackCommitSubject(input.title)
  const bracketPrefix = dominantBracketPrefix(log)
  if (!commitMessageConventionEnabled(input) && bracketPrefix) {
    return limitCommitMessage(`${bracketPrefix} ${subject}`)
  }
  const scope = commitScope(files)
  const type = commitType(files)
  return limitCommitMessage(`${type}${scope ? `(${scope})` : ""}: ${subject}`)
}

function commitMessageFromAgentResult(result: unknown) {
  const payload = asRecord(result)
  return firstTextLine(payload.text) ?? firstTextLine(payload.outputText) ?? firstTextLine(payload.message)
}

function fallbackCommitSubject(title: string) {
  const subject = title.trim().replace(/\s+/g, " ").replace(/[.!?]+$/g, "")
  if (!subject) return "complete backlog item"
  return subject.charAt(0).toLowerCase() + subject.slice(1)
}

function commitMessageConventionEnabled(input: ApproveAndMergeInput) {
  return input.codePractices?.find((item) => item.practice === "commit_message_convention")?.enabled ?? false
}

function dominantBracketPrefix(log: string) {
  const prefixes = log.split("\n").map((line) => line.match(/^(\[[^\]]+\])/)?.[1]).filter(isString)
  const counts = new Map<string, number>()
  prefixes.forEach((prefix) => counts.set(prefix, (counts.get(prefix) ?? 0) + 1))
  return [...counts.entries()].find(([, count]) => count >= 2)?.[0]
}

function statusFileNames(status: string) {
  return status.split("\n").map(statusFileName).filter(isString)
}

function statusFileName(line: string) {
  const file = line.slice(3).trim()
  return file.includes(" -> ") ? file.split(" -> ").at(-1) : file
}

function commitScope(files: string[]) {
  const firstFile = files.find(Boolean)
  if (!firstFile) return undefined
  const parts = firstFile.split("/")
  if (parts[0] === "packages" && parts[1]) return parts[1]
  if (parts[0] === "src" && parts[1]) return parts[1]
  return parts[0]?.replace(/\.[^.]+$/g, "")
}

function commitType(files: string[]) {
  if (files.length && files.every((file) => /\.(test|spec)\.[jt]sx?$/.test(file))) return "test"
  if (files.length && files.every((file) => /\.(md|mdx|txt)$/.test(file))) return "docs"
  if (files.some((file) => /(^|\/)(package\.json|pnpm-lock\.yaml)$/.test(file))) return "build"
  return "fix"
}

function limitCommitMessage(message: string) {
  return message.length <= 74 ? message : message.slice(0, 74).replace(/\s+\S*$/, "")
}

function isString(value: unknown): value is string {
  return typeof value === "string"
}

async function mergeConflictPrompt(input: ApproveAndMergeInput, targetBranch: string, attempt: number) {
  const [status, files] = await Promise.all([
    storyStatus(input.worktree, "--short"),
    git(input.worktree, ["diff", "--name-only", "--diff-filter=U"]),
  ])
  return [
    `Backlog item: ${input.title}`,
    "",
    input.summary,
    "",
    `Story branch: ${input.storyBranch}`,
    `Target branch: ${targetBranch}`,
    `Resolution attempt: ${attempt} of ${maxMergeConflictResolutionAttempts}`,
    "",
    `Conflicted files:\n${files}`,
    "",
    `Git status:\n${truncateText(status, 8_000)}`,
  ].join("\n")
}

async function storyStatus(cwd: string, format: "--porcelain" | "--short") {
  return git(cwd, ["status", format, "--", ".", ...runtimeArtifactPathspecs])
}

async function addStoryChanges(cwd: string) {
  await git(cwd, ["add", "-A", "--", ".", ...runtimeArtifactPathspecs])
}

function unresolvedMergeConflictMessage(conflicts: string[]) {
  return `Merge conflict agent finished with unresolved conflicts: ${conflicts.join(", ")}`
}

async function git(cwd: string, args: string[]) {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 20 * 1024 * 1024 })
    return stdout.trim()
  } catch (error) {
    throw new Error(gitErrorMessage(args, error))
  }
}

function gitErrorMessage(args: string[], error: unknown) {
  const record = asRecord(error)
  const output = stringValue(record.stderr) || stringValue(record.stdout)
  const message = output?.trim() || errorMessage(error)
  return `git ${args.join(" ")} failed: ${message}`
}

function firstTextLine(value: unknown) {
  const line = stringValue(value)
    ?.trim()
    .replace(/^```(?:text)?\s*/, "")
    .replace(/\s*```$/, "")
    .split("\n")
    .find(Boolean)
    ?.trim()
  return line?.replace(/^["'`]|["'`]$/g, "")
}

function truncateText(value: string, limit: number) {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n[truncated]`
}

function approveMergeLogPath(worktree: string) {
  return join(worktree, ".blame", "logs", "approve-merge.log")
}

function approveMergeContext(input: ApproveAndMergeInput) {
  return {
    providerId: input.providerId,
    modelId: input.modelId,
    reasoningEffort: input.reasoningEffort,
    repositoryRoot: input.repositoryRoot,
    worktree: input.worktree,
    storyBranch: input.storyBranch,
  }
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

function credentialLabel(input: RuntimeCredentialInput) {
  if (input.credentialLabel) return input.credentialLabel
  if (input.providerId === openAICompatibleProviderID) return input.modelId
  return undefined
}

function startContext(input: StartSessionInput) {
  return {
    providerId: input.providerId,
    modelId: input.modelId,
    mode: input.mode ?? "act",
    maxIterations: input.maxIterations ?? defaultSessionMaxIterations,
    ...promptMetadata(input.prompt),
  }
}

function sessionContext(input: StartSessionInput, sessionId: string): ProductionSessionContext {
  return {
    maxIterations: input.maxIterations ?? defaultSessionMaxIterations,
    mode: input.mode ?? "act",
    modelId: input.modelId,
    providerId: input.providerId,
    sessionId,
  }
}

function developmentMaxIterations() {
  const value = Number(process.env.BLAME_AGENT_DEVELOPMENT_MAX_ITERATIONS)
  return Number.isFinite(value) && value > 0 ? value : defaultDevelopmentMaxIterations
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
    await appendFile(file, `${JSON.stringify(logLine(message, safeLogPayload(payload)))}\n`, "utf8")
  } catch {
    console.warn("[blame-agent]", "log write failed")
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
  const status = resultStatus(payload)
  if (!status || !["failed", "error", "cancelled", "aborted", "mistake_limit"].includes(status)) return undefined
  return stringValue(payload.error) ?? stringValue(payload.message) ?? `Cline send ended with status ${status}.`
}

function resultStatus(payload: Record<string, unknown>) {
  return (
    stringValue(payload.status) ??
    stringValue(payload.state) ??
    stringValue(payload.finishReason) ??
    stringValue(payload.reason)
  )
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

function eventLogPayload(event: AgentEvent) {
  const payload = asRecord(event.payload)
  if (event.type === "usage") return summarizeUsage({ aggregateUsage: asRecord(payload.usage) as never })
  if (event.type === "tool") return toolLogPayload(payload)
  if (event.type === "done") return doneLogPayload(payload)
  if (event.type === "error") return errorLogPayload(payload)
  return {
    sessionId: event.sessionId,
    status: event.type,
  }
}

function toolLogPayload(payload: Record<string, unknown>) {
  const toolCall = asRecord(payload.toolCall)
  const toolName = stringValue(toolCall.name) ?? stringValue(toolCall.toolName) ?? stringValue(payload.toolName)
  return {
    durationMs: numberValue(payload.durationMs),
    status: stringValue(payload.phase),
    success: stringValue(payload.phase) !== "failed",
    toolName,
  }
}

function doneLogPayload(payload: Record<string, unknown>) {
  return {
    finishReason: stringValue(payload.reason) ?? stringValue(payload.finishReason),
    status: stringValue(payload.status) ?? "done",
    ...summarizeUsage({ aggregateUsage: asRecord(payload.usage) as never }),
  }
}

function errorLogPayload(payload: Record<string, unknown>) {
  const error = asRecord(payload.error)
  return {
    errorType: stringValue(error.name) ?? "Error",
    message: stringValue(payload.message) ?? stringValue(error.message),
    status: "failed",
  }
}

function sendResultLogPayload(result: unknown, durationMs: number) {
  const payload = asRecord(result)
  return {
    durationMs,
    finishReason: stringValue(payload.finishReason) ?? stringValue(payload.reason),
    status: resultStatus(payload) ?? "completed",
    ...summarizeUsage({ aggregateUsage: asRecord(payload.usage) as never }),
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

function blockedToolReason(toolName: string, input: unknown) {
  if (toolName !== "run_commands") return undefined
  const command = stringValue(asRecord(input).command)
  if (!command) return undefined
  return blockedCommandParts.some((part) => command.includes(part))
    ? "Command blocked by security policy"
    : undefined
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

function errorType(error: unknown) {
  return error instanceof Error ? error.constructor.name : "Error"
}
