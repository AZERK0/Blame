import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { access, appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { promisify } from "node:util";

import type {
  ClineCore,
  ClineCoreOptions,
  ClineCoreStartInput,
  CoreSessionConfig,
  CoreSessionEvent,
  OAuthCredentials as ClineOAuthCredentials,
  OAuthLoginCallbacks,
  OAuthPrompt,
  OAuthProviderInterface,
  OAuthServerListeningInfo,
  RemoteOptions as ClineRemoteOptions,
  SessionUsageSummary,
} from "@cline/sdk";
import {
  buildWorkspaceMetadata,
  getClineDefaultSystemPrompt,
  mergeRulesForSystemPrompt,
} from "@cline/sdk";

import {
  getBlameTelemetry,
  type Context,
  withoutTelemetryEnvironment,
} from "@blame/telemetry";

import {
  codeReviewGraphToolNames,
  codeReviewGraphTools,
} from "./code-review-graph-tools.js";
import {
  contextCompressionConfig,
  contextCompressionExtensions,
  effectiveContextCompressionMode,
} from "./context-compression.js";
import type { HeadroomCompressionUsage } from "./context-compression.js";
import { HeadroomSidecar } from "./headroom-sidecar.js";
import { blameSpecialistAgentsSystemPrompt } from "./specialist-agents.js";
import {
  deleteProviderCredential,
  listProviders,
  resolveProviderCredential,
  saveOAuthCredential,
  saveProviderCredential,
} from "./cloud-api.js";
import {
  projectInitializationCorrectionPrompt,
  parseProjectInitializationPayload,
  parseProjectInitializationResult,
  projectInitializationResultSchema,
  projectInitializationPrompt,
  scanProjectForInitialization,
} from "./project-initialization.js";
import {
  projectCodePracticesCorrectionPrompt,
  projectCodePracticesPrompt,
  projectCodePracticesResultSchema,
  resolveProjectCodePracticesResult,
} from "./project-code-practices.js";
import {
  scanProjectCodePractices,
  type ProjectCodePracticesScan,
} from "./project-code-practices-scan.js";
import {
  parseProjectInitializationRepairResult,
  projectInitializationRepairPrompt,
} from "./project-initialization-repair.js";
import {
  collectProjectInitializationImpactDiagnostics,
  deterministicInitializationImpact,
  parseProjectInitializationImpactResult,
  projectInitializationImpactPrompt,
} from "./project-initialization-impact.js";
import { optimizeUserStoryPrompt } from "./prompt-optimization.js";
import { generateTitle } from "./title-generation.js";
import { loadPrompt } from "./prompt-loader.js";
import { knownOpenAICodexPreviewModels } from "./openai-codex-preview-models.js";
import { createProviderCompatibleFetch } from "./provider-schema-compatibility.js";
import { fallbackCommitSubject } from "./commit-message.js";
import { AgentTelemetry } from "./agent-telemetry.js";
import { taskComplexityBucket } from "./telemetry-cohorts.js";
import {
  applyProductionEnvironment,
  appendProductionConfig,
  assertRepositoryPath,
  assertWorkspacePath,
  blameCheckpointConfig,
  blameCompactionConfig,
  createProductionLogger,
  loadProductionConfig,
  promptMetadata,
  runtimeConfigExtensions,
  runtimePluginPaths,
  safeLogPayload,
  shouldAbortForUsage,
  summarizeUsage,
  usageLimitMessage,
} from "./production.js";
import type { ProjectInitializationScan } from "./project-initialization.js";
import type { ProductionSessionContext } from "./production.js";
import type {
  AgentApprovalRequest,
  AgentBackendConfig,
  AgentContextCompressionMode,
  AgentEvent,
  AgentRuntimeEvents,
  AgentUsageSummary,
  AnalyzeProjectCodePracticesInput,
  AnalyzeProjectCodePracticesResult,
  ApiConnection,
  ApproveAndMergeInput,
  ApproveAndMergeResult,
  AssessProjectInitializationImpactInput,
  AssessProjectInitializationImpactResult,
  CodeGraphStatus,
  CodeReviewGraphProvider,
  CompareCheckpointInput,
  CompareCheckpointResult,
  GenerateCommitMessageInput,
  GenerateCommitMessageResult,
  GenerateTitleInput,
  GenerateTitleResult,
  InitializeProjectInput,
  InitializeProjectResult,
  LoginOAuthProviderInput,
  NewProjectGenerationResult,
  OAuthCredentials,
  OptimizeUserStoryPromptInput,
  OptimizeUserStoryPromptResult,
  ProjectCodePracticeKey,
  ProjectCodePracticePreference,
  RepairProjectInitializationInput,
  RepairProjectInitializationResult,
  ResolveApprovalInput,
  ResolveMergeConflictsInput,
  ResolveMergeConflictsResult,
  RestoreCheckpointInput,
  RestoreCheckpointResult,
  SaveProviderCredentialInput,
  SendDevelopmentSessionInput,
  SendSessionInput,
  StartDevelopmentSessionInput,
  StartNewProjectGenerationInput,
  StartSessionInput,
} from "./types.js";

const execFileAsync = promisify(execFile);
const readTools = [
  "read_files",
  "search_codebase",
  "fetch_web_content",
  "get_preview_devtools",
  "get_preview_container_logs",
  ...codeReviewGraphToolNames,
];
const initializationFallbackReadTools = new Set([
  "read_files",
  "search_codebase",
]);
const writeTools = ["run_commands", "editor", "apply_patch"];
const blockedCommandParts = [
  "rm -rf",
  "sudo",
  "curl | sh",
  "wget | sh",
  "> /dev/",
];
const defaultSessionMaxIterations = 32;
const defaultDevelopmentMaxIterations = 96;
const maxInitializationAttempts = 3;
const maxMergeConflictResolutionAttempts = 3;
const runtimeArtifactPaths = [".blame", ".blame-preview", ".pnpm-store"];
const runtimeArtifactPathspecs = runtimeArtifactPaths.map(
  (path) => `:!${path}`,
);
const productionLogger = createProductionLogger();
const blameTelemetry = getBlameTelemetry();
const openAICompatibleProviderID = "openai-compatible";

type MergeConflictRuntimeInput =
  | ApproveAndMergeInput
  | ResolveMergeConflictsInput;
type CommitMessageRuntimeInput =
  | ApproveAndMergeInput
  | GenerateCommitMessageInput;
const attachmentDirectoryName = ".blame/attachments";

type ToolApprovalRequest = {
  toolName?: string;
  name?: string;
  sessionId?: string;
  reason?: string;
  input?: unknown;
};

type ToolApprovalResult = {
  approved: boolean;
};

type RuntimeCredentialInput = {
  apiConnection: ApiConnection;
  providerId: string;
  modelId?: string;
  credentialLabel?: string;
};

type ClineSdk = typeof import("@cline/sdk");
type AgentTool = NonNullable<CoreSessionConfig["extraTools"]>[number];
type ToolContext = Parameters<AgentTool["execute"]>[1];

type PendingApproval = {
  request: AgentApprovalRequest;
  resolve(result: ToolApprovalResult): void;
};

type RuntimeStartSessionInput = StartSessionInput & {
  enableAgentTeams?: boolean;
  enableSpawnAgent?: boolean;
};

type RuntimeSessionSummary = {
  sessionId?: string;
};

type RuntimeClineResult = {
  result?: Record<string, unknown> & { text?: string };
  sessionId: string;
};

type InitializationCorrection = {
  previousResult: string;
  validationError: string;
};

type StructuredResultSubmitTool = {
  tool: AgentTool;
  input?: unknown;
};

type InitializationCredential = {
  apiKey: string;
  authMethod?: string;
  baseUrl: string | null;
};

type ProjectInitializationAttempt = {
  result: unknown;
  sessionId: string;
  submittedInput?: unknown;
};

type ProjectCodePracticesAttempt = {
  input: unknown;
  sessionId: string;
};

type CodePracticesAttemptOutcome =
  | { complete: true; result: AnalyzeProjectCodePracticesResult }
  | { complete: false; correction: InitializationCorrection };

type ProjectInitializationRepairAttempt = {
  sessionId: string;
  text: string;
};

type StoryMergePreparation = {
  baseCommit: string;
  integration: string;
  targetBranch: string;
  targetClean: boolean;
  upstream?: GitUpstream;
};

type PreviewDevtoolsTarget = {
  available: boolean;
  browserUrl: string;
  currentUrl?: string;
  id?: string;
  scope?: string;
  mcpServer: {
    args: string[];
    command: string;
    name: string;
  };
};

type DevelopmentUserInput = {
  prompt: string;
  userFiles: string[];
  userImages: string[];
};

type DevelopmentAttachmentInput = Pick<
  DevelopmentUserInput,
  "userFiles" | "userImages"
>;
type DevelopmentPromptInput = Pick<
  StartDevelopmentSessionInput,
  | "codeSelectionAttachments"
  | "feedback"
  | "feedbackCodeSelectionAttachments"
  | "feedbackFileAttachments"
  | "fileAttachments"
  | "summary"
  | "title"
> &
  Pick<SendDevelopmentSessionInput, "feedbackOnly">;

type RuntimeOptions = {
  codeReviewGraph?: CodeReviewGraphProvider;
  openExternalUrl?(url: string): void;
  git?(cwd: string, args: string[]): Promise<string>;
  previewDevtools?(
    input?: PreviewDevtoolsTargetInput,
  ):
    | Promise<PreviewDevtoolsTarget | undefined>
    | PreviewDevtoolsTarget
    | undefined;
  previewContainerLogs?: PreviewContainerLogsProvider;
};

type PreviewDevtoolsTargetInput = {
  scope?: string;
  timeoutMs?: number;
};

type PreviewContainerLogsInput = {
  service?: string;
  signal?: AbortSignal;
  tailLines?: number;
  worktree: string;
};

type PreviewContainerLogsProvider = (
  input: PreviewContainerLogsInput,
) => Promise<unknown> | unknown;
type HeadroomSavingsTotals = {
  compressionCount: number;
  lastTokensSaved: number;
  tokensAfter: number;
  tokensBefore: number;
  tokensSaved: number;
};

let customGitRunner:
  | ((cwd: string, args: string[]) => Promise<string>)
  | undefined;

export class BlameAgentRuntime {
  private clines = new Map<string, Promise<ClineCore>>();
  private sessionBackendKeys = new Map<string, string>();
  private readonly agentTelemetry = new AgentTelemetry();
  private unsubscribers = new Map<string, () => void>();
  private pendingApprovals = new Map<string, PendingApproval>();
  private alwaysAllowedTools = new Set<string>();
  private autoApprovedWriteToolSessions = new Set<string>();
  private sessionLogFiles = new Map<string, string>();
  private sessionLogWrites = new Map<string, Promise<void>>();
  private sessionReleases = new Map<string, Promise<void>>();
  private sessionContexts = new Map<string, ProductionSessionContext>();
  private sessionStartInputs = new Map<string, ClineCoreStartInput>();
  private sessionQualityBaselines = new Map<string, string>();
  private sessionEventSignatures = new Map<string, Map<string, number>>();
  private sessionHeadroomSavings = new Map<string, HeadroomSavingsTotals>();
  private sessionToolInputs = new Map<string, unknown>();
  private sessionIterations = new Map<string, number>();
  private sessionSpawnAgentActiveCounts = new Map<string, number>();
  private sessionUsageSignatures = new Map<string, string>();
  private structuredEventSessions = new Set<string>();
  private readonly headroomSidecar = new HeadroomSidecar();
  private readonly productionConfig = loadProductionConfig();
  private readonly events?: AgentRuntimeEvents;
  private readonly options: RuntimeOptions;

  constructor(events?: AgentRuntimeEvents, options: RuntimeOptions = {}) {
    this.events = events;
    this.options = options;
    if (options.git) {
      customGitRunner = options.git;
    }
    applyProductionEnvironment(this.productionConfig);
    void import("@cline/sdk").catch(() => undefined);
  }

  providers = {
    list: (connection: ApiConnection) => listProviders(connection),
    saveCredential: (
      connection: ApiConnection,
      input: SaveProviderCredentialInput,
    ) => saveProviderCredential(connection, input),
    deleteCredential: (connection: ApiConnection, id: string) =>
      deleteProviderCredential(connection, { id }),
    loginOAuth: (input: LoginOAuthProviderInput) => this.loginOAuth(input),
  };

  sessions = {
    start: (input: StartSessionInput) => this.startSession(input),
    startDevelopment: (input: StartDevelopmentSessionInput) =>
      this.startDevelopmentSession(input),
    send: (input: SendSessionInput) => this.sendSession(input),
    sendDevelopment: (input: SendDevelopmentSessionInput) =>
      this.sendDevelopmentSession(input),
    abort: (sessionId: string) => this.abortSession(sessionId),
    compareCheckpoint: (input: CompareCheckpointInput) =>
      this.compareCheckpoint(input),
    list: () => this.listSessions(),
    messages: (sessionId: string) => this.readMessages(sessionId),
    restoreCheckpoint: (input: RestoreCheckpointInput) =>
      this.restoreCheckpoint(input),
    usage: (sessionId: string) => this.readUsage(sessionId),
    unsubscribe: (sessionId: string) => this.unsubscribeSession(sessionId),
    releaseWorkspace: (workspace: string) =>
      this.releaseWorkspaceSessions(workspace),
  };

  approvals = {
    resolve: (input: ResolveApprovalInput) => this.resolveApproval(input),
  };

  initializations = {
    run: (input: InitializeProjectInput) => this.initializeProject(input),
    repair: (input: RepairProjectInitializationInput) =>
      this.repairProjectInitialization(input),
    assessImpact: (input: AssessProjectInitializationImpactInput) =>
      this.assessProjectInitializationImpact(input),
  };

  codePractices = {
    run: (input: AnalyzeProjectCodePracticesInput) =>
      this.analyzeProjectCodePractices(input),
  };

  newProjects = {
    generate: (input: StartNewProjectGenerationInput) =>
      this.generateNewProject(input),
  };

  promptOptimizer = {
    optimizeUserStory: (input: OptimizeUserStoryPromptInput) =>
      this.optimizeUserStoryPrompt(input),
    generateTitle: (input: GenerateTitleInput) => this.generateTitle(input),
  };

  approveAndMerge = (input: ApproveAndMergeInput) =>
    this.approveAndMergeStory(input);

  generateCommitMessage = (input: GenerateCommitMessageInput) =>
    this.generateWorkspaceCommitMessage(input);

  resolveMergeConflicts = (input: ResolveMergeConflictsInput) =>
    this.resolveWorkspaceMergeConflicts(input);

  async shutdown() {
    const sessionIds = await this.activeSessionIds();
    await Promise.allSettled(
      sessionIds.map((sessionId) => this.abortSession(sessionId, false)),
    );
    await Promise.all(
      sessionIds.map((sessionId) => this.unsubscribeSession(sessionId)),
    );
    this.resolvePendingApprovals();
    this.sessionLogFiles.clear();
    this.sessionLogWrites.clear();
    this.sessionReleases.clear();
    this.sessionContexts.clear();
    this.sessionEventSignatures.clear();
    await this.disposeCore();
    await this.headroomSidecar.dispose();
    this.agentTelemetry.shutdown();
  }

  private async core(backend?: AgentBackendConfig) {
    const key = backendKey(backend);
    const current = this.clines.get(key);
    if (current) return current;
    const next = this.createCore(backend);
    this.clines.set(key, next);
    return next;
  }

  private async createCore(backend?: AgentBackendConfig) {
    const module = await import("@cline/sdk");
    return module.ClineCore.create({
      ...coreBackendOptions(backend),
      clientName: "blame",
      toolPolicies: toolPolicies(false),
      capabilities: {
        requestToolApproval: (request: ToolApprovalRequest) =>
          this.requestApproval(request),
      },
      fetch: createProviderCompatibleFetch(),
      logger: productionLogger,
    });
  }

  private async sessionCore(sessionId: string) {
    const key = this.sessionBackendKeys.get(sessionId);
    const current = key ? this.clines.get(key) : undefined;
    return current ?? this.core();
  }

  private attachedSession(sessionId: string | null | undefined) {
    const normalizedSessionId = sessionId?.trim();
    if (!normalizedSessionId) return undefined;
    if (!this.sessionContexts.has(normalizedSessionId)) return undefined;
    if (!this.unsubscribers.has(normalizedSessionId)) return undefined;
    return { sessionId: normalizedSessionId };
  }

  private async startSession(input: RuntimeStartSessionInput) {
    assertWorkspacePath(input.cwd, input.workspaceRoot, "cwd");
    const requestedSessionId = input.sessionId?.trim();
    const sessionId = requestedSessionId || createBlameSessionId();
    this.agentTelemetry.start(sessionId, {
      ...input,
      taskComplexityBucket: sessionTaskComplexity(input),
    });
    const telemetryContext = this.agentTelemetry.context(sessionId);
    const codeGraphPreparation = this.prepareSessionCodeGraph(
      sessionId,
      input.workspaceRoot,
    );
    const startLogFile = startLogPath(input.cwd);
    await appendLog(
      startLogFile,
      "start requested",
      startContext(input),
      telemetryContext,
    );
    const startedAt = Date.now();
    try {
      const credential = await resolveProviderCredential(input.apiConnection, {
        providerId: input.providerId,
        label: credentialLabel(input),
      });
      await appendLog(
        startLogFile,
        "credential resolved",
        {
          providerId: credential.providerId,
          authMethod: credential.authMethod,
          hasBaseUrl: !!credential.baseUrl,
        },
        telemetryContext,
      );
      const resolvedCredential = await this.refreshOAuthCredential(
        input.apiConnection,
        credential,
        {
          force: forceOAuthRefresh(credential.providerId),
        },
      );
      this.agentTelemetry.setAuthentication(
        sessionId,
        resolvedCredential.authMethod,
      );
      await appendLog(
        startLogFile,
        "credential refreshed",
        {
          providerId: resolvedCredential.providerId,
          authMethod: resolvedCredential.authMethod,
          hasBaseUrl: !!resolvedCredential.baseUrl,
          expires: resolvedCredential.oauthCredentials?.expires,
        },
        telemetryContext,
      );
      await this.syncClineOAuthProviderSettings(resolvedCredential);
      if (resolvedCredential.authMethod === "oauth") {
        await appendLog(
          startLogFile,
          "cline oauth settings synced",
          {
            providerId: resolvedCredential.providerId,
            accountId: resolvedCredential.oauthCredentials?.accountId,
            email: resolvedCredential.oauthCredentials?.email,
            expires: resolvedCredential.oauthCredentials?.expires,
          },
          telemetryContext,
        );
      }
      const cline = await this.core(input.backend);
      await appendLog(
        startLogFile,
        "cline core ready",
        undefined,
        telemetryContext,
      );
      const sessionLogFile = sessionLogPath(input.cwd, sessionId);
      const contextCompressionMode = effectiveContextCompressionMode(
        input.contextCompressionMode,
      );
      await this.subscribeSession(sessionId, input.backend);
      this.sessionBackendKeys.set(sessionId, backendKey(input.backend));
      this.sessionLogFiles.set(sessionId, sessionLogFile);
      this.sessionContexts.set(sessionId, sessionContext(input, sessionId));
      if (input.autoApproveWriteTools) {
        this.autoApprovedWriteToolSessions.add(sessionId);
      }
      await waitForTelemetryCohorts(codeGraphPreparation);
      const headroomBaseUrl = await this.ensureHeadroomSidecar(
        sessionId,
        input,
        contextCompressionMode,
      );
      const autoSendPrompt = input.autoSendPrompt !== false;
      const pluginPaths = runtimePluginPaths(
        this.productionConfig,
        input.pluginPaths,
      );
      const configExtensions =
        input.configExtensions ??
        runtimeConfigExtensions(this.productionConfig);
      const startInput = {
        ...(autoSendPrompt ? { prompt: input.prompt } : {}),
        ...(input.initialMessages?.length
          ? { initialMessages: input.initialMessages }
          : {}),
        ...(autoSendPrompt && input.userImages?.length
          ? { userImages: input.userImages }
          : {}),
        ...(autoSendPrompt && input.userFiles?.length
          ? { userFiles: input.userFiles }
          : {}),
        config: {
          ...appendProductionConfig({
            sessionId,
            providerId: input.providerId,
            modelId: input.modelId,
            apiKey: resolvedCredential.apiKey,
            baseUrl: resolvedCredential.baseUrl ?? undefined,
            knownModels: knownOpenAICodexPreviewModels(
              input.providerId,
              input.modelId,
            ),
            thinking: !!input.reasoningEffort,
            reasoningEffort: input.reasoningEffort,
            systemPrompt:
              input.systemPrompt ?? loadPrompt("default-agent-system"),
            cwd: input.cwd,
            workspaceRoot: input.workspaceRoot,
            checkpoint: {
              enabled:
                input.checkpointEnabled ??
                blameCheckpointConfig(this.productionConfig).enabled,
            },
            mode: input.mode ?? "act",
            maxIterations: input.maxIterations ?? defaultSessionMaxIterations,
            disableMcpSettingsTools:
              input.disableMcpSettingsTools ??
              this.productionConfig.disableMcpSettingsTools,
            ...(pluginPaths ? { pluginPaths } : {}),
            compaction: contextCompressionConfig(
              this.productionConfig,
              contextCompressionMode,
            ),
            enableTools: true,
            enableSpawnAgent: input.enableSpawnAgent ?? false,
            enableAgentTeams: input.enableAgentTeams ?? false,
            extensions: contextCompressionExtensions(
              this.productionConfig,
              contextCompressionMode,
              {
                logger: (message, payload) =>
                  this.logSession(sessionId, message, payload),
                headroomBaseUrl,
                modelId: input.modelId,
                onCompression: (usage) =>
                  this.recordHeadroomCompression(sessionId, usage),
              },
            ),
            extensionContext: extensionContext(input),
            extraTools: runtimeTools(
              this.options,
              input.workspaceRoot,
              input.previewDevtoolsScope,
            ),
          }),
        },
        localRuntime: {
          ...(configExtensions ? { configExtensions } : {}),
          ...(pluginPaths ? { pluginPaths } : {}),
        },
        interactive: !autoSendPrompt,
        source: "blame-desktop",
        toolPolicies: toolPolicies(!!input.autoApproveWriteTools),
      } as const;
      this.sessionStartInputs.set(sessionId, startInput);
      await this.captureSessionQualityBaseline(sessionId);
      if (autoSendPrompt) {
        this.agentTelemetry.startModelRequest(sessionId);
        void this.agentTelemetry
          .withinSession<RuntimeClineResult>(
            sessionId,
            () => cline.start(startInput) as Promise<RuntimeClineResult>,
          )
          .then((session) =>
            this.completeSessionStart(
              startLogFile,
              startedAt,
              input,
              session.sessionId,
              sessionLogFile,
            ),
          )
          .catch((error: unknown) =>
            this.failSessionStart(startLogFile, startedAt, sessionId, error),
          );
        await this.logSession(sessionId, "session subscribed");
        this.emitSessionNotice(sessionId, `Cline debug log: ${sessionLogFile}`);
        return { sessionId };
      }
      const session =
        await this.agentTelemetry.withinSession<RuntimeClineResult>(
          sessionId,
          () => cline.start(startInput) as Promise<RuntimeClineResult>,
        );
      this.sessionBackendKeys.set(session.sessionId, backendKey(input.backend));
      await appendLog(
        startLogFile,
        "session created",
        {
          durationMs: Date.now() - startedAt,
          sessionId: session.sessionId,
          logFile: sessionLogFile,
        },
        this.agentTelemetry.context(session.sessionId),
      );
      await this.logSession(session.sessionId, "session created", {
        ...startContext(input),
        logFile: sessionLogFile,
      });
      if (input.autoApproveWriteTools) {
        this.emitSessionNotice(
          session.sessionId,
          "Development session write tools auto-approved.",
        );
      }
      if (session.sessionId !== sessionId) {
        await waitForTelemetryCohorts(
          this.prepareSessionCodeGraph(session.sessionId, input.workspaceRoot),
        );
      }
      await this.logSession(session.sessionId, "session subscribed");
      this.emitSessionNotice(
        session.sessionId,
        `Cline debug log: ${sessionLogFile}`,
      );
      if (input.autoSendPrompt === false) {
        await this.logSession(session.sessionId, "prompt deferred", {
          ...promptMetadata(input.prompt),
        });
      }
      this.agentTelemetry.ready(session.sessionId, true);
      return session;
    } catch (error) {
      const activeContext = this.agentTelemetry.context(sessionId);
      await appendLog(
        startLogFile,
        "start failed",
        {
          durationMs: Date.now() - startedAt,
          errorType: errorType(error),
          message: errorMessage(error),
          status: "failed",
        },
        activeContext,
      );
      this.agentTelemetry.fail(sessionId, error);
      throw error;
    }
  }

  private async completeSessionStart(
    startLogFile: string,
    startedAt: number,
    input: StartSessionInput,
    sessionId: string,
    sessionLogFile: string,
  ) {
    const activeContext = this.agentTelemetry.context(sessionId);
    await appendLog(
      startLogFile,
      "session created",
      {
        durationMs: Date.now() - startedAt,
        sessionId,
        logFile: sessionLogFile,
      },
      activeContext,
    );
    await this.logSession(sessionId, "session created", {
      ...startContext(input),
      logFile: sessionLogFile,
    });
    if (input.autoApproveWriteTools) {
      this.emitSessionNotice(
        sessionId,
        "Development session write tools auto-approved.",
      );
    }
  }

  private async failSessionStart(
    startLogFile: string,
    startedAt: number,
    sessionId: string,
    error: unknown,
  ) {
    const activeContext = this.agentTelemetry.context(sessionId);
    const message = errorMessage(error);
    await appendLog(
      startLogFile,
      "start failed",
      {
        durationMs: Date.now() - startedAt,
        errorType: errorType(error),
        message,
        status: "failed",
      },
      activeContext,
    );
    this.emitSessionError(sessionId, message);
    this.agentTelemetry.fail(sessionId, error);
  }

  private async sendSession(
    input: SendSessionInput,
    interventionType?: string,
  ) {
    this.agentTelemetry.beginTurn(
      input.sessionId,
      input.executionId,
      input.storyId,
      sessionTaskComplexity(input),
    );
    if (interventionType) {
      this.agentTelemetry.humanIntervention(input.sessionId, interventionType);
    }
    try {
      await this.captureSessionQualityBaseline(input.sessionId);
      const cline = await this.sessionCore(input.sessionId);
      return await this.sendPrompt(cline, input.sessionId, input.prompt, {
        userFiles: input.userFiles,
        userImages: input.userImages,
      });
    } catch (error) {
      this.agentTelemetry.fail(input.sessionId, error);
      throw error;
    }
  }

  private async sendDevelopmentSession(input: SendDevelopmentSessionInput) {
    const developmentInput = await developmentUserInput(
      input,
      this.attachmentDirectory(input.sessionId),
    );
    return this.sendSession(
      {
        sessionId: input.sessionId,
        executionId: input.executionId,
        storyId: input.storyId,
        ...developmentInput,
      },
      input.feedbackOnly ? "feedback" : undefined,
    );
  }

  private async abortSession(sessionId: string, humanInitiated = true) {
    const cline = await this.sessionCore(sessionId);
    if (humanInitiated)
      this.agentTelemetry.humanIntervention(sessionId, "abort");
    try {
      await cline.abort(sessionId, "User aborted from Blame");
    } finally {
      this.agentTelemetry.cancel(sessionId);
    }
  }

  private async releaseWorkspaceSessions(workspace: string) {
    const sessionIds = workspaceSessionIds(this.sessionLogFiles, workspace);
    await Promise.allSettled(
      sessionIds.map((sessionId) => this.abortSession(sessionId, false)),
    );
    await Promise.all(
      sessionIds.map((sessionId) => this.unsubscribeSession(sessionId)),
    );
  }

  private async compareCheckpoint(
    input: CompareCheckpointInput,
  ): Promise<CompareCheckpointResult> {
    const cline = await this.sessionCore(input.sessionId);
    return cline.compareCheckpoint(input);
  }

  private async restoreCheckpoint(
    input: RestoreCheckpointInput,
  ): Promise<RestoreCheckpointResult> {
    return this.agentTelemetry.runCheckpointRestore(input.sessionId, () =>
      this.restoreCheckpointWorkflow(input),
    );
  }

  private async restoreCheckpointWorkflow(
    input: RestoreCheckpointInput,
  ): Promise<RestoreCheckpointResult> {
    const cline = await this.sessionCore(input.sessionId);
    const restoreMessages = input.restore?.messages ?? false;
    const start = restoreMessages
      ? this.restoreCheckpointStartInput(input.sessionId)
      : undefined;
    const result = await cline.restore({
      checkpointRunCount: input.checkpointRunCount,
      cwd: input.cwd,
      restore: {
        messages: restoreMessages,
        omitCheckpointMessageFromSession:
          input.restore?.omitCheckpointMessageFromSession,
        workspace: input.restore?.workspace ?? true,
      },
      ...(start ? { start } : {}),
      sessionId: input.sessionId,
    });
    await this.attachRestoredCheckpointSession(
      input.sessionId,
      result.sessionId,
      start,
      cline,
    );
    return result;
  }

  private restoreCheckpointStartInput(sessionId: string) {
    const start = this.sessionStartInputs.get(sessionId);
    if (!start) {
      throw new Error(
        "Unable to restore Cline messages for a session started before this app session.",
      );
    }
    const restoredSessionId = createBlameSessionId();
    return {
      ...start,
      config: {
        ...start.config,
        sessionId: restoredSessionId,
      },
    };
  }

  private async attachRestoredCheckpointSession(
    sourceSessionId: string,
    restoredSessionId: string | undefined,
    start: ClineCoreStartInput | undefined,
    cline: ClineCore,
  ) {
    if (!restoredSessionId || !start) return;
    if (restoredSessionId === sourceSessionId) return;
    this.agentTelemetry.restore(sourceSessionId, restoredSessionId);
    if (!this.unsubscribers.has(restoredSessionId)) {
      await this.subscribeCoreSession(restoredSessionId, cline);
    }
    const backendKeyValue = this.sessionBackendKeys.get(sourceSessionId);
    if (backendKeyValue)
      this.sessionBackendKeys.set(restoredSessionId, backendKeyValue);
    const cwd = start.config.cwd;
    if (cwd) {
      this.sessionLogFiles.set(
        restoredSessionId,
        sessionLogPath(cwd, restoredSessionId),
      );
    }
    const context = this.sessionContexts.get(sourceSessionId);
    if (context) {
      this.sessionContexts.set(restoredSessionId, {
        ...context,
        sessionId: restoredSessionId,
      });
    }
    this.sessionStartInputs.set(restoredSessionId, start);
    await this.captureSessionQualityBaseline(restoredSessionId);
    if (this.autoApprovedWriteToolSessions.has(sourceSessionId)) {
      this.autoApprovedWriteToolSessions.add(restoredSessionId);
    }
  }

  private async listSessions() {
    const lists = await Promise.all(
      Array.from(this.clines.values()).map(async (cline) => {
        try {
          return await (await cline).list(50);
        } catch {
          return [];
        }
      }),
    );
    if (lists.length) return lists.flat();
    const cline = await this.core();
    return cline.list(50);
  }

  private async readMessages(sessionId: string) {
    const cline = await this.sessionCore(sessionId);
    return cline.readMessages(sessionId);
  }

  private async resumeMessages(
    sessionId: string | null | undefined,
    backend?: AgentBackendConfig,
  ) {
    const normalizedSessionId = sessionId?.trim();
    if (!normalizedSessionId) return undefined;
    try {
      const messages = await (
        await this.core(backend)
      ).readMessages(normalizedSessionId);
      return messages.length ? messages : undefined;
    } catch {
      return undefined;
    }
  }

  private async readUsage(
    sessionId: string,
  ): Promise<AgentUsageSummary | undefined> {
    const cline = await this.sessionCore(sessionId);
    return normalizeAgentUsageSummary(
      await cline.getAccumulatedUsage(sessionId),
    );
  }

  private async initializeProject(
    input: InitializeProjectInput,
  ): Promise<InitializeProjectResult> {
    return this.agentTelemetry.runBusinessOperation(
      input,
      "project_initialization",
      () => this.initializeProjectWorkflow(input),
    );
  }

  private async analyzeProjectCodePractices(
    input: AnalyzeProjectCodePracticesInput,
  ): Promise<AnalyzeProjectCodePracticesResult> {
    return this.agentTelemetry.runBusinessOperation(
      input,
      "project_code_practices",
      () => this.analyzeProjectCodePracticesWorkflow(input),
    );
  }

  private async analyzeProjectCodePracticesWorkflow(
    input: AnalyzeProjectCodePracticesInput,
  ): Promise<AnalyzeProjectCodePracticesResult> {
    assertWorkspacePath(input.cwd, input.workspaceRoot, "cwd");
    const credential = await this.initializationCredential(input);
    const scan = await scanProjectCodePractices(input.workspaceRoot);
    const cline = await this.core(input.backend);
    return this.runCodePracticesAttempts(cline, input, scan, credential);
  }

  private async runCodePracticesAttempts(
    cline: ClineCore,
    input: AnalyzeProjectCodePracticesInput,
    scan: ProjectCodePracticesScan,
    credential: InitializationCredential,
  ): Promise<AnalyzeProjectCodePracticesResult> {
    let correction = input.validationFeedback;
    for (let attempt = 1; attempt <= maxInitializationAttempts; attempt += 1) {
      const result = await this.startCodePracticesAttempt(
        cline,
        input,
        scan,
        credential,
        correction,
      );
      const outcome = this.codePracticesAttemptOutcome(
        input,
        result,
        scan,
        attempt,
      );
      if (outcome.complete) return outcome.result;
      correction = outcome.correction;
    }
    throw new Error("Code practice analysis did not return a valid result");
  }

  private codePracticesAttemptOutcome(
    input: AnalyzeProjectCodePracticesInput,
    result: ProjectCodePracticesAttempt,
    scan: ProjectCodePracticesScan,
    attempt: number,
  ): CodePracticesAttemptOutcome {
    try {
      return {
        complete: true,
        result: parsedCodePracticesAttempt(result, scan),
      };
    } catch (error) {
      if (attempt === maxInitializationAttempts) throw error;
      const correction = this.projectInitializationRetry(
        input,
        "project_code_practices",
        result.input,
        error,
      );
      return { complete: false, correction };
    }
  }

  private async startCodePracticesAttempt(
    cline: ClineCore,
    input: AnalyzeProjectCodePracticesInput,
    scan: ProjectCodePracticesScan,
    credential: InitializationCredential,
    correction?: InitializationCorrection,
  ) {
    const submit = projectCodePracticesSubmitTool();
    const session = await this.startCodePracticesAgent(
      cline,
      input,
      scan,
      credential,
      submit.tool,
      correction,
    );
    if (!submit.input) {
      throw new Error("Code practice analysis agent did not return a result");
    }
    return { input: submit.input, sessionId: session.sessionId };
  }

  private startCodePracticesAgent(
    cline: ClineCore,
    input: AnalyzeProjectCodePracticesInput,
    scan: ProjectCodePracticesScan,
    credential: InitializationCredential,
    submitTool: AgentTool,
    correction?: InitializationCorrection,
  ) {
    return this.agentTelemetry.runOperation(
      input,
      "project_code_practices",
      () =>
        cline.start({
          prompt: codePracticesPrompt(scan, correction),
          config: codePracticesConfig(input, credential, submitTool),
          interactive: false,
          source: "blame-project-code-practices",
          toolPolicies: codePracticesToolPolicies(),
        }) as Promise<RuntimeClineResult>,
      credential.authMethod,
    );
  }

  private async initializeProjectWorkflow(
    input: InitializeProjectInput,
  ): Promise<InitializeProjectResult> {
    assertWorkspacePath(input.cwd, input.workspaceRoot, "cwd");
    const resolvedCredential = await this.initializationCredential(input);
    const scan = await scanProjectForInitialization(input.workspaceRoot);
    const cline = await this.core(input.backend);
    let correction = input.validationFeedback;
    for (let attempt = 1; attempt <= maxInitializationAttempts; attempt += 1) {
      const result = await this.startProjectInitializationAttempt(
        cline,
        input,
        scan,
        resolvedCredential,
        correction,
      );
      try {
        return parseProjectInitializationAttempt(result, scan, input);
      } catch (error) {
        if (attempt === maxInitializationAttempts) throw error;
        correction = this.projectInitializationRetry(
          input,
          "project_initialization",
          result.result,
          error,
        );
      }
    }
    throw new Error("Project initialization agent did not return a valid result");
  }

  private async startProjectInitializationAttempt(
    cline: ClineCore,
    input: InitializeProjectInput,
    scan: ProjectInitializationScan,
    credential: InitializationCredential,
    correction?: InitializationCorrection,
  ) {
    const submitTool = projectInitializationSubmitTool();
    const session = await this.startProjectInitializationAgent(
      cline,
      input,
      scan,
      credential,
      submitTool.tool,
      correction,
    );
    return collectProjectInitializationAttempt(cline, session, submitTool);
  }

  private startProjectInitializationAgent(
    cline: ClineCore,
    input: InitializeProjectInput,
    scan: ProjectInitializationScan,
    credential: InitializationCredential,
    submitTool: AgentTool,
    correction: InitializationCorrection | undefined,
  ) {
    return this.agentTelemetry.runOperation(
      input,
      "project_initialization",
      () =>
        cline.start({
          prompt: initializationPrompt(scan, correction),
          config: initializationConfig(input, credential, submitTool),
          interactive: false,
          source: "blame-project-initialization",
          toolPolicies: initializationToolPolicies(),
        }) as Promise<RuntimeClineResult>,
      credential.authMethod,
    );
  }

  private async repairProjectInitialization(
    input: RepairProjectInitializationInput,
  ): Promise<RepairProjectInitializationResult> {
    return this.agentTelemetry.runBusinessOperation(
      input,
      "project_initialization_repair",
      () => this.repairProjectInitializationWorkflow(input),
    );
  }

  private async repairProjectInitializationWorkflow(
    input: RepairProjectInitializationInput,
  ): Promise<RepairProjectInitializationResult> {
    assertWorkspacePath(input.cwd, input.workspaceRoot, "cwd");
    const credential = await this.runtimeCredential(input);
    const scan = await scanProjectForInitialization(input.workspaceRoot);
    const cline = await this.core(input.backend);
    let correction: InitializationCorrection | undefined;
    for (let attempt = 1; attempt <= maxInitializationAttempts; attempt += 1) {
      const result = await this.startProjectInitializationRepairAttempt(
        cline,
        input,
        scan,
        credential,
        correction,
      );
      try {
        return parseProjectInitializationRepairAttempt(result, scan);
      } catch (error) {
        if (attempt === maxInitializationAttempts) throw error;
        correction = this.projectInitializationRetry(
          input,
          "project_initialization_repair",
          result.text,
          error,
        );
      }
    }
    throw new Error("Project initialization repair agent did not return a valid result");
  }

  private async startProjectInitializationRepairAttempt(
    cline: ClineCore,
    input: RepairProjectInitializationInput,
    scan: ProjectInitializationScan,
    credential: InitializationCredential,
    correction?: InitializationCorrection,
  ): Promise<ProjectInitializationRepairAttempt> {
    const session = await this.agentTelemetry.runOperation(
      input,
      "project_initialization_repair",
      () =>
        cline.start({
          prompt: projectInitializationRepairPrompt(input, scan, correction),
          config: initializationRepairConfig(input, credential),
          interactive: false,
          source: "blame-project-initialization-repair",
          toolPolicies: initializationToolPolicies(),
        }) as Promise<RuntimeClineResult>,
      credential.authMethod,
    );
    return projectInitializationRepairAttempt(session);
  }

  private projectInitializationRetry(
    input: InitializeProjectInput | RepairProjectInitializationInput,
    operationName: string,
    previousResult: unknown,
    error: unknown,
  ) {
    this.agentTelemetry.recordOperationRetry(input, operationName, error);
    return initializationCorrection(previousResult, error);
  }

  private async assessProjectInitializationImpact(
    input: AssessProjectInitializationImpactInput,
  ): Promise<AssessProjectInitializationImpactResult> {
    return this.agentTelemetry.runBusinessOperation(
      input,
      "project_initialization_impact",
      () => this.assessProjectInitializationImpactWorkflow(input),
    );
  }

  private async assessProjectInitializationImpactWorkflow(
    input: AssessProjectInitializationImpactInput,
  ): Promise<AssessProjectInitializationImpactResult> {
    assertWorkspacePath(input.cwd, input.workspaceRoot, "cwd");
    const diagnostics =
      await collectProjectInitializationImpactDiagnostics(input);
    const deterministic = deterministicInitializationImpact(diagnostics);
    if (deterministic) return { ...deterministic, diagnostics };
    const credential = await this.runtimeCredential(input);
    const cline = await this.core(input.backend);
    const session = await this.startProjectInitializationImpactAgent(
      input,
      diagnostics,
      credential,
      cline,
    );
    const text = session.result?.text;
    if (!text)
      throw new Error(
        "Project initialization impact agent did not return a result",
      );
    return {
      sessionId: session.sessionId,
      ...parseProjectInitializationImpactResult(text),
      diagnostics,
    };
  }

  private startProjectInitializationImpactAgent(
    input: AssessProjectInitializationImpactInput,
    diagnostics: Awaited<
      ReturnType<typeof collectProjectInitializationImpactDiagnostics>
    >,
    credential: InitializationCredential,
    cline: ClineCore,
  ) {
    return this.agentTelemetry.runOperation(
      input,
      "project_initialization_impact",
      () =>
        cline.start({
          prompt: projectInitializationImpactPrompt(diagnostics),
          config: initializationImpactConfig(input, credential),
          interactive: false,
          source: "blame-project-initialization-impact",
          toolPolicies: initializationToolPolicies(),
        }) as Promise<RuntimeClineResult>,
      credential.authMethod,
    );
  }

  private async generateNewProject(
    input: StartNewProjectGenerationInput,
  ): Promise<NewProjectGenerationResult> {
    assertWorkspacePath(input.cwd, input.workspaceRoot, "cwd");
    const credential = await this.runtimeCredential(input);
    const cline = await this.core(input.backend);
    const sessionId = input.sessionId ?? createBlameSessionId();
    this.agentTelemetry.start(sessionId, input);
    this.agentTelemetry.setAuthentication(sessionId, credential.authMethod);
    const sessionLogFile = sessionLogPath(input.cwd, sessionId);
    await this.subscribeSession(sessionId, input.backend);
    this.sessionBackendKeys.set(sessionId, backendKey(input.backend));
    this.sessionLogFiles.set(sessionId, sessionLogFile);
    this.sessionContexts.set(sessionId, {
      maxIterations: newProjectGenerationMaxIterations(),
      mode: "yolo",
      modelId: input.modelId,
      providerId: input.providerId,
      sessionId,
    });
    this.autoApprovedWriteToolSessions.add(sessionId);
    this.emitSessionNotice(sessionId, "New project generation agent started.");
    this.emitSessionNotice(sessionId, `Cline debug log: ${sessionLogFile}`);

    try {
      const config = await newProjectGenerationConfig(
        input,
        credential,
        sessionId,
        this.productionConfig,
      );
      this.agentTelemetry.startModelRequest(sessionId);
      const session =
        await this.agentTelemetry.withinSession<RuntimeClineResult>(
          sessionId,
          () =>
            cline.start({
              prompt: newProjectGenerationPrompt(input),
              config,
              interactive: false,
              source: "blame-new-project-generation",
              toolPolicies: toolPolicies(true),
            }) as Promise<RuntimeClineResult>,
        );
      const failure = resultFailureMessage(session.result);
      if (failure) {
        if (!(await generatedProjectLooksReady(input.cwd)))
          throw new Error(failure);
        this.emitSessionNotice(
          sessionId,
          `New project generation agent ended after scaffold: ${failure}`,
        );
      }
      this.emitSessionNotice(
        sessionId,
        "New project generation agent finished.",
      );
      return {
        path: input.cwd,
        sessionId,
      };
    } finally {
      await this.unsubscribeSession(sessionId);
    }
  }

  private async optimizeUserStoryPrompt(
    input: OptimizeUserStoryPromptInput,
  ): Promise<OptimizeUserStoryPromptResult> {
    assertWorkspacePath(input.cwd, input.workspaceRoot, "cwd");
    const prompt = input.prompt.trim();
    if (!prompt)
      throw new Error("Prompt optimizer requires a user story prompt.");
    const credential = await this.runtimeCredential(input);
    const cline = await this.core(input.backend);
    return this.agentTelemetry.runOperation(
      input,
      "prompt_optimization",
      () => optimizeUserStoryPrompt({ ...input, prompt }, cline, credential),
      credential.authMethod,
    );
  }

  private async generateTitle(
    input: GenerateTitleInput,
  ): Promise<GenerateTitleResult> {
    assertWorkspacePath(input.cwd, input.workspaceRoot, "cwd");
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error("Title generator requires a prompt.");
    const credential = await this.runtimeCredential(input);
    const cline = await this.core(input.backend);
    return this.agentTelemetry.runOperation(
      input,
      "title_generation",
      () => generateTitle({ ...input, prompt }, cline, credential),
      credential.authMethod,
    );
  }

  private async initializationCredential(input: RuntimeCredentialInput) {
    return this.runtimeCredential(input);
  }

  private async runtimeCredential(input: RuntimeCredentialInput) {
    const credential = await resolveProviderCredential(input.apiConnection, {
      providerId: input.providerId,
      label: credentialLabel(input),
    });
    return this.refreshOAuthCredential(input.apiConnection, credential);
  }

  private async approveAndMergeStory(
    input: ApproveAndMergeInput,
  ): Promise<ApproveAndMergeResult> {
    return this.agentTelemetry.runBusinessOperation(input, "merge", () =>
      this.approveAndMergeStoryOperation(input),
    );
  }

  private async approveAndMergeStoryOperation(
    input: ApproveAndMergeInput,
  ): Promise<ApproveAndMergeResult> {
    assertRepositoryPath(input.repositoryRoot, "repositoryRoot");
    assertRepositoryPath(input.worktree, "worktree");
    const logFile = approveMergeLogPath(input.worktree);
    await appendLog(
      logFile,
      "approve merge requested",
      approveMergeContext(input),
    );
    const preparation = await this.prepareStoryMerge(input);
    await this.commitStoryWork(input);
    await this.mergeTargetIntoStory(
      input,
      preparation.targetBranch,
      preparation.upstream,
    );
    await removeRuntimeEnvChanges(input.worktree, preparation.baseCommit);
    return this.finalizeStoryMerge(input, logFile, preparation);
  }

  private async prepareStoryMerge(
    input: ApproveAndMergeInput,
  ): Promise<StoryMergePreparation> {
    await assertGitRepository(input.repositoryRoot);
    await assertGitRepository(input.worktree);
    const targetBranch = await currentGitBranch(input.repositoryRoot);
    await validateMergeBranches(input, targetBranch);
    const upstream = await optionalGitUpstream(input.repositoryRoot);
    const targetClean = await cleanGitStatus(input.repositoryRoot);
    const integration = targetClean
      ? input.repositoryRoot
      : await integrationWorktree(input.repositoryRoot, targetBranch);
    await pullIntegrationWorktree(integration, upstream);
    const baseCommit = await git(integration, ["rev-parse", "HEAD"]);
    return { baseCommit, integration, targetBranch, targetClean, upstream };
  }

  private async finalizeStoryMerge(
    input: ApproveAndMergeInput,
    logFile: string,
    preparation: StoryMergePreparation,
  ) {
    const { baseCommit, integration, targetBranch, targetClean, upstream } =
      preparation;
    try {
      await git(integration, ["merge", "--ff-only", input.storyBranch]);
      const mergeCommit = await git(integration, ["rev-parse", "HEAD"]);
      if (!targetClean) {
        await advanceTargetBranch(
          input.repositoryRoot,
          targetBranch,
          input.storyBranch,
        );
      }
      await pushIntegrationWorktree(integration, upstream, logFile);
      await appendLog(logFile, "approve merge completed", {
        baseCommit,
        mergeCommit,
        targetBranch,
      });
      return { baseCommit, mergeCommit, targetBranch };
    } finally {
      if (!targetClean) {
        await removeIntegrationWorktree(input.repositoryRoot, integration);
      }
    }
  }

  private async commitStoryWork(input: ApproveAndMergeInput) {
    const status = await storyStatus(input.worktree, "--porcelain");
    if (!status.trim()) return;
    const message = await this.generateCommitMessageWithAgent(
      input,
      approveMergeLogPath(input.worktree),
      "blame-approve-merge",
    );
    await addStoryChanges(input.worktree);
    await git(input.worktree, ["commit", "-m", message]);
    const nextStatus = await storyStatus(input.worktree, "--porcelain");
    if (nextStatus.trim())
      throw new Error(
        "Story worktree still has uncommitted changes after commit.",
      );
  }

  private async generateWorkspaceCommitMessage(
    input: GenerateCommitMessageInput,
  ): Promise<GenerateCommitMessageResult> {
    assertRepositoryPath(input.repositoryRoot, "repositoryRoot");
    assertRepositoryPath(input.worktree, "worktree");
    await assertGitRepository(input.repositoryRoot);
    await assertGitRepository(input.worktree);
    const status = await storyStatus(
      input.worktree,
      "--porcelain",
      commitMessagePaths(input),
    );
    if (!status.trim())
      throw new Error(
        "No selected changes available for commit message generation.",
      );
    const logFile = commitMessageLogPath(input.worktree);
    await appendLog(logFile, "commit message generation requested", {
      providerId: input.providerId,
      modelId: input.modelId,
      reasoningEffort: input.reasoningEffort,
      repositoryRoot: input.repositoryRoot,
      selectedPaths: input.selectedPaths ?? [],
      worktree: input.worktree,
    });
    const message = await this.generateCommitMessageWithAgent(
      input,
      logFile,
      "blame-commit-message-generation",
    );
    return { message };
  }

  private async generateCommitMessageWithAgent(
    input: CommitMessageRuntimeInput,
    logFile: string,
    source: string,
  ) {
    try {
      const startedAt = Date.now();
      const credential = await this.runtimeCredential(input);
      const cline = await this.core(input.backend);
      const session = await this.agentTelemetry.runOperation(
        input,
        "commit_message_generation",
        async () =>
          cline.start({
            prompt: await commitMessagePrompt(input),
            config: commitMessageConfig(input, credential),
            interactive: false,
            source,
            toolPolicies: initializationToolPolicies(),
          }),
        credential.authMethod,
      );
      const message = commitMessageFromAgentResult(session.result);
      await appendLog(logFile, "commit message agent finished", {
        durationMs: Date.now() - startedAt,
        sessionId: session.sessionId,
        status: resultStatus(asRecord(session.result)),
        success: Boolean(message),
      });
      if (message) return message;
    } catch (error) {
      await appendLog(logFile, "commit message agent failed", {
        errorType: errorType(error),
        status: "failed",
      });
    }
    await appendLog(logFile, "commit message fallback selected", {
      status: "fallback",
      success: true,
    });
    return fallbackCommitMessage(input);
  }

  private async mergeTargetIntoStory(
    input: ApproveAndMergeInput,
    targetBranch: string,
    upstream?: GitUpstream,
  ) {
    const mergeTarget = upstream
      ? `${upstream.remote}/${upstream.branch}`
      : targetBranch;
    if (upstream)
      await git(input.worktree, ["fetch", upstream.remote, upstream.branch]);
    try {
      await git(input.worktree, ["merge", mergeTarget]);
      return;
    } catch (error) {
      if (!(await hasMergeConflicts(input.worktree))) throw error;
    }
    await this.resolveMergeConflictsWithAgent(
      input,
      targetBranch,
      approveMergeLogPath(input.worktree),
    );
    const conflicts = await mergeConflictFiles(input.worktree);
    if (conflicts.length)
      throw new Error(unresolvedMergeConflictMessage(conflicts));
    await addStoryChanges(input.worktree);
    await git(input.worktree, ["commit", "--no-edit"]);
  }

  private async resolveWorkspaceMergeConflicts(
    input: ResolveMergeConflictsInput,
  ): Promise<ResolveMergeConflictsResult> {
    assertRepositoryPath(input.repositoryRoot, "repositoryRoot");
    assertRepositoryPath(input.worktree, "worktree");
    const logFile = mergeConflictLogPath(input.worktree);
    await appendLog(logFile, "merge conflict resolution requested", {
      providerId: input.providerId,
      modelId: input.modelId,
      reasoningEffort: input.reasoningEffort,
      repositoryRoot: input.repositoryRoot,
      worktree: input.worktree,
    });
    await assertGitRepository(input.repositoryRoot);
    await assertGitRepository(input.worktree);
    const targetBranch =
      input.targetBranch || (await currentGitBranch(input.worktree)) || "HEAD";
    await this.resolveMergeConflictsWithAgent(
      input,
      targetBranch,
      logFile,
      false,
    );
    const conflicts = await mergeConflictFiles(input.worktree);
    return { conflicts, resolved: conflicts.length === 0 };
  }

  private async resolveMergeConflictsWithAgent(
    input: MergeConflictRuntimeInput,
    targetBranch: string,
    logFile: string,
    throwOnUnresolved = true,
  ) {
    let conflicts = await mergeConflictFiles(input.worktree);
    for (
      let attempt = 1;
      attempt <= maxMergeConflictResolutionAttempts && conflicts.length;
      attempt += 1
    ) {
      const failure = await this.runMergeConflictAgent(
        input,
        targetBranch,
        attempt,
        logFile,
      );
      conflicts = await mergeConflictFiles(input.worktree);
      await appendLog(logFile, "merge conflict agent finished", {
        status: conflicts.length ? "conflicts_remaining" : "resolved",
        success: !conflicts.length,
      });
      if (failure && conflicts.length) throw new Error(failure);
    }
    if (conflicts.length && throwOnUnresolved)
      throw new Error(unresolvedMergeConflictMessage(conflicts));
  }

  private async runMergeConflictAgent(
    input: MergeConflictRuntimeInput,
    targetBranch: string,
    attempt: number,
    logFile: string,
  ) {
    const startedAt = Date.now();
    const credential = await this.runtimeCredential(input);
    const cline = await this.core(input.backend);
    const session = await this.agentTelemetry.runOperation(
      input,
      "merge_conflict_resolution",
      async () =>
        cline.start({
          prompt: await mergeConflictPrompt(input, targetBranch, attempt),
          config: mergeConflictConfig(input, credential),
          interactive: false,
          source: "blame-merge-conflict-resolution",
          toolPolicies: toolPolicies(true),
        }),
      credential.authMethod,
    );
    await appendLog(logFile, "merge conflict agent run completed", {
      durationMs: Date.now() - startedAt,
      sessionId: session.sessionId,
      status: resultStatus(asRecord(session.result)),
    });
    return resultFailureMessage(session.result);
  }

  private async subscribeSession(
    sessionId: string,
    backend?: AgentBackendConfig,
  ) {
    const cline = await this.core(backend);
    await this.subscribeCoreSession(sessionId, cline);
  }

  private async subscribeCoreSession(sessionId: string, cline: ClineCore) {
    await this.unsubscribeSession(sessionId, true);
    this.sessionReleases.delete(sessionId);
    const unsubscribe = await cline.subscribe(
      (payload: CoreSessionEvent) => {
        this.agentTelemetry.observeCoreEvent(sessionId, payload);
        if (this.shouldSkipFallbackChunk(sessionId, payload)) return;
        const spawnAgentPhase = clineSessionSpawnAgentPhase(payload);
        if (this.shouldSkipSessionDisplayEvent(sessionId, payload)) return;
        const event = this.withSessionIteration(
          sessionId,
          this.withToolInput(sessionId, normalizeEvent(sessionId, payload)),
        );
        if (this.shouldSkipDuplicateSessionEvent(sessionId, event)) return;
        if (spawnAgentPhase) {
          this.updateSessionSpawnAgentState(sessionId, spawnAgentPhase);
        }
        void this.handleSessionEvent(sessionId, event);
        this.events?.emit(event);
      },
      { sessionId },
    );
    this.unsubscribers.set(sessionId, unsubscribe);
  }

  private withSessionIteration(sessionId: string, event: AgentEvent) {
    const payload = asRecord(event.payload);
    const eventIteration = numberValue(payload.iteration);
    if (eventIteration !== undefined)
      this.sessionIterations.set(sessionId, eventIteration);
    if (
      (event.type !== "tool" &&
        event.type !== "text" &&
        event.type !== "reasoning") ||
      eventIteration !== undefined
    )
      return event;
    const iteration = this.sessionIterations.get(sessionId);
    if (iteration === undefined) return event;
    return { ...event, payload: { ...payload, iteration } };
  }

  private withToolInput(sessionId: string, event: AgentEvent) {
    if (event.type !== "tool") return event;
    const payload = asRecord(event.payload);
    const toolCall = asRecord(payload.toolCall);
    const toolCallId = stringValue(toolCall.id) ?? stringValue(payload.toolCallId);
    if (!toolCallId) return event;
    const key = `${sessionId}:${toolCallId}`;
    const completed =
      payload.phase === "finished" || payload.hookEventName === "tool_result";
    if (toolCall.input !== undefined) {
      if (completed) this.sessionToolInputs.delete(key);
      else this.sessionToolInputs.set(key, toolCall.input);
      return event;
    }
    const input = this.sessionToolInputs.get(key);
    if (input === undefined) return event;
    if (completed) this.sessionToolInputs.delete(key);
    return {
      ...event,
      payload: { ...payload, toolCall: { ...toolCall, input } },
    };
  }

  private shouldSkipDuplicateSessionEvent(
    sessionId: string,
    event: AgentEvent,
  ) {
    const signature = duplicateEventSignature(event);
    if (!signature) return false;
    const now = Date.now();
    const signatures =
      this.sessionEventSignatures.get(sessionId) ?? new Map<string, number>();
    const previous = signatures.get(signature);
    signatures.set(signature, now);
    this.sessionEventSignatures.set(sessionId, signatures);
    removeOldEventSignatures(signatures, now);
    return previous !== undefined && now - previous < 100;
  }

  private async handleSessionEvent(sessionId: string, event: AgentEvent) {
    if (streamingAgentEvent(event)) {
      this.agentTelemetry.observeEvent(sessionId, event);
      return;
    }
    const activeContext = this.agentTelemetry.context(sessionId);
    const eventUsage = eventUsageSummary(event);
    const usage = await this.usageForEvent(sessionId, event, eventUsage);
    if (event.type === "done" && usage)
      this.agentTelemetry.recordUsageSummary(sessionId, usage);
    const qualityContext =
      event.type === "done"
        ? this.agentTelemetry.completeModelRequest(sessionId, event.payload)
        : undefined;
    if (event.type === "done") {
      await this.recordSessionQuality(sessionId, qualityContext);
    }
    this.agentTelemetry.observeEvent(sessionId, event);
    await this.logSession(
      sessionId,
      `event:${event.type}`,
      eventLogPayload(event),
      activeContext,
    );
    if (!usage) return;
    await this.handleUsageUpdate(sessionId, usage, activeContext);
  }

  private async usageForEvent(
    sessionId: string,
    event: AgentEvent,
    eventUsage: AgentUsageSummary | undefined,
  ) {
    if (eventUsage || event.type !== "done") return eventUsage;
    const span = blameTelemetry.startSpan("blame.agent.usage_summary", {
      parent: this.agentTelemetry.context(sessionId),
    });
    try {
      const usage = await blameTelemetry.withinSpan(span, () =>
        this.readUsage(sessionId),
      );
      span.end();
      return usage;
    } catch (error) {
      span.recordError(error).end("failed");
      return undefined;
    }
  }

  private async handleUsageUpdate(
    sessionId: string,
    usage: AgentUsageSummary,
    activeContext: Context | undefined,
  ) {
    const usageSignature = JSON.stringify(summarizeUsage(usage));
    if (this.sessionUsageSignatures.get(sessionId) === usageSignature) return;
    this.sessionUsageSignatures.set(sessionId, usageSignature);
    const context = this.sessionContexts.get(sessionId) ?? { sessionId };
    await this.logSession(
      sessionId,
      "usage updated",
      {
        ...context,
        ...summarizeUsage(usage),
      },
      activeContext,
    );
    if (!shouldAbortForUsage(usage, this.productionConfig)) return;
    const message = usageLimitMessage(usage, this.productionConfig);
    this.emitSessionError(sessionId, message);
    await this.abortSession(sessionId, false);
  }

  private unsubscribeSession(sessionId: string, preserveTelemetry = false) {
    const current = this.sessionReleases.get(sessionId);
    if (current) return current;
    const release = this.releaseSession(sessionId, preserveTelemetry);
    this.sessionReleases.set(sessionId, release);
    void release.then(
      () => this.deleteSessionRelease(sessionId, release),
      () => this.deleteSessionRelease(sessionId, release),
    );
    return release;
  }

  private deleteSessionRelease(sessionId: string, release: Promise<void>) {
    if (this.sessionReleases.get(sessionId) === release)
      this.sessionReleases.delete(sessionId);
  }

  private async releaseSession(sessionId: string, preserveTelemetry: boolean) {
    const unsubscribe = this.unsubscribers.get(sessionId);
    this.unsubscribers.delete(sessionId);
    try {
      unsubscribe?.();
    } catch {}
    this.clearSessionState(sessionId, preserveTelemetry);
    const logFile = this.sessionLogFiles.get(sessionId);
    this.sessionLogFiles.delete(sessionId);
    await this.sessionLogWrites.get(sessionId)?.catch(() => undefined);
    if (logFile)
      await appendLog(logFile, "session unsubscribed").catch(() => undefined);
    this.sessionLogWrites.delete(sessionId);
  }

  private clearSessionState(sessionId: string, preserveTelemetry: boolean) {
    this.autoApprovedWriteToolSessions.delete(sessionId);
    this.sessionContexts.delete(sessionId);
    this.sessionEventSignatures.delete(sessionId);
    this.sessionHeadroomSavings.delete(sessionId);
    this.sessionIterations.delete(sessionId);
    this.sessionSpawnAgentActiveCounts.delete(sessionId);
    for (const key of this.sessionToolInputs.keys()) {
      if (key.startsWith(`${sessionId}:`)) this.sessionToolInputs.delete(key);
    }
    this.sessionUsageSignatures.delete(sessionId);
    this.sessionBackendKeys.delete(sessionId);
    this.sessionQualityBaselines.delete(sessionId);
    this.sessionStartInputs.delete(sessionId);
    this.structuredEventSessions.delete(sessionId);
    if (!preserveTelemetry) this.agentTelemetry.remove(sessionId);
  }

  private async recordSessionQuality(
    sessionId: string,
    parent: Context | undefined,
  ) {
    const cwd = this.sessionStartInputs.get(sessionId)?.config.cwd;
    const baseline = this.sessionQualityBaselines.get(sessionId);
    if (!cwd || baseline === undefined) return;
    const span = blameTelemetry.startSpan("blame.agent.quality", { parent });
    try {
      const status = await blameTelemetry.withinSpan(span, () =>
        workspaceStatus(cwd),
      );
      this.agentTelemetry.recordQuality(
        sessionId,
        qualityFromStatusDelta(baseline, status),
      );
      this.sessionQualityBaselines.set(sessionId, status);
      span.end();
    } catch (error) {
      span.recordError(error).end("failed");
    }
  }

  private async captureSessionQualityBaseline(sessionId: string) {
    const cwd = this.sessionStartInputs.get(sessionId)?.config.cwd;
    if (!cwd) return;
    try {
      this.sessionQualityBaselines.set(sessionId, await workspaceStatus(cwd));
    } catch {
      this.sessionQualityBaselines.delete(sessionId);
    }
  }

  private shouldSkipSessionDisplayEvent(
    sessionId: string,
    event: CoreSessionEvent,
  ) {
    const spawnAgentActive =
      (this.sessionSpawnAgentActiveCounts.get(sessionId) ?? 0) > 0;
    return !shouldDisplayClineSessionEvent(event, spawnAgentActive);
  }

  private updateSessionSpawnAgentState(
    sessionId: string,
    phase: "started" | "finished",
  ) {
    const current = this.sessionSpawnAgentActiveCounts.get(sessionId) ?? 0;
    const next = nextSpawnAgentActiveCount(current, phase);
    if (next) {
      this.sessionSpawnAgentActiveCounts.set(sessionId, next);
      return;
    }
    this.sessionSpawnAgentActiveCounts.delete(sessionId);
  }

  private shouldSkipFallbackChunk(sessionId: string, event: CoreSessionEvent) {
    if (event.type === "agent_event") {
      this.structuredEventSessions.add(sessionId);
      return false;
    }
    return (
      event.type === "chunk" &&
      event.payload.stream === "agent" &&
      this.structuredEventSessions.has(sessionId)
    );
  }

  private async activeSessionIds() {
    const sessionIds = new Set(this.unsubscribers.keys());
    await Promise.all(
      Array.from(this.clines.values()).map(async (core) => {
        try {
          const sessions = (await (
            await core
          ).list(50)) as RuntimeSessionSummary[];
          sessions.forEach((session) => {
            if (session.sessionId) sessionIds.add(session.sessionId);
          });
        } catch {}
      }),
    );

    return Array.from(sessionIds);
  }

  private resolvePendingApprovals() {
    this.pendingApprovals.forEach((approval) =>
      approval.resolve({ approved: false }),
    );
    this.pendingApprovals.clear();
    this.alwaysAllowedTools.clear();
    this.autoApprovedWriteToolSessions.clear();
  }

  private requestApproval(
    request: ToolApprovalRequest,
  ): Promise<ToolApprovalResult> | ToolApprovalResult {
    const toolName = request.toolName ?? request.name ?? "unknown";
    const blockedReason = blockedToolReason(toolName, request.input);
    if (blockedReason) {
      if (request.sessionId)
        this.emitSessionError(request.sessionId, blockedReason);
      return { approved: false };
    }
    if (
      !writeTools.includes(toolName) ||
      this.alwaysAllowedTools.has(toolName) ||
      (request.sessionId &&
        this.autoApprovedWriteToolSessions.has(request.sessionId))
    ) {
      this.events?.emit({
        type: "notice",
        sessionId: request.sessionId,
        payload: { message: `Auto-approved tool: ${toolName}` },
      });
      if (request.sessionId)
        void this.logSession(request.sessionId, "tool auto-approved", request);
      return { approved: true };
    }

    return new Promise((resolve) => {
      const approval = toApprovalRequest(request, toolName);
      if (approval.sessionId) {
        this.agentTelemetry.humanIntervention(
          approval.sessionId,
          "tool_approval",
        );
      }
      this.pendingApprovals.set(approval.id, { request: approval, resolve });
      if (approval.sessionId)
        void this.logSession(
          approval.sessionId,
          "tool approval requested",
          approval,
        );
      this.events?.emit({
        type: "approval",
        sessionId: approval.sessionId,
        payload: approval,
      });
    });
  }

  private resolveApproval(input: ResolveApprovalInput) {
    const pending = this.pendingApprovals.get(input.requestId);
    if (!pending) return false;

    this.pendingApprovals.delete(input.requestId);
    if (input.decision === "always")
      this.alwaysAllowedTools.add(pending.request.toolName);
    if (pending.request.sessionId) {
      void this.logSession(
        pending.request.sessionId,
        "tool approval resolved",
        {
          toolName: pending.request.toolName,
          decision: input.decision,
        },
      );
    }
    pending.resolve({ approved: input.decision !== "deny" });
    return true;
  }

  private async loginOAuth(input: LoginOAuthProviderInput) {
    const provider = await this.oauthProvider(input.providerId);
    const credentials = await provider.login({
      onAuth: (info: { url: string; instructions?: string }) => {
        this.options.openExternalUrl?.(info.url);
        this.events?.emit({
          type: "notice",
          payload: {
            providerId: input.providerId,
            message: info.instructions ?? "OAuth login opened.",
          },
        });
      },
      onPrompt: async (prompt: OAuthPrompt) => prompt.defaultValue ?? "",
      onProgress: (message: string) => {
        this.events?.emit({
          type: "notice",
          payload: { providerId: input.providerId, message },
        });
      },
      onServerListening: (info: OAuthServerListeningInfo) => {
        this.events?.emit({
          type: "notice",
          payload: {
            providerId: input.providerId,
            message: `Waiting for OAuth callback on ${info.callbackUrl}`,
          },
        });
      },
      onServerClose: () => {
        this.events?.emit({
          type: "notice",
          payload: {
            providerId: input.providerId,
            message: "OAuth callback server closed.",
          },
        });
      },
    });

    return saveOAuthCredential(input.apiConnection, {
      providerId: input.providerId,
      label: input.label,
      apiKey: provider.getApiKey(credentials),
      oauthCredentials: toBlameOAuthCredentials(credentials),
      baseUrl: input.baseUrl ?? null,
    });
  }

  private async refreshOAuthCredential(
    connection: ApiConnection,
    credential: Awaited<ReturnType<typeof resolveProviderCredential>>,
    options: { force?: boolean } = {},
  ) {
    if (credential.authMethod !== "oauth" || !credential.oauthCredentials)
      return credential;
    if (
      !options.force &&
      credential.oauthCredentials.expires > Date.now() + 60_000
    )
      return credential;

    const provider = await this.oauthProvider(credential.providerId);
    const refreshed = await provider.refreshToken(credential.oauthCredentials);
    const saved = await saveOAuthCredential(connection, {
      providerId: credential.providerId,
      label: credential.label,
      apiKey: provider.getApiKey(refreshed),
      oauthCredentials: toBlameOAuthCredentials(refreshed),
      baseUrl: credential.baseUrl,
    });

    return {
      ...credential,
      apiKey: provider.getApiKey(refreshed),
      oauthCredentials: toBlameOAuthCredentials(refreshed),
      authMethod: saved.authMethod,
    };
  }

  private async syncClineOAuthProviderSettings(
    credential: Awaited<ReturnType<typeof resolveProviderCredential>>,
  ) {
    if (credential.authMethod !== "oauth" || !credential.oauthCredentials)
      return;
    if (!supportedClineOAuthProvider(credential.providerId)) return;
    const sdk = await import("@cline/sdk");
    const providerId = sdk.normalizeOAuthProvider(credential.providerId);
    const manager = new sdk.ProviderSettingsManager();
    const existing = manager.getProviderSettings(providerId);
    sdk.saveLocalProviderOAuthCredentials(manager, providerId, existing, {
      access: credential.oauthCredentials.access,
      refresh: credential.oauthCredentials.refresh,
      expires: credential.oauthCredentials.expires,
      accountId:
        credential.oauthCredentials.accountId ??
        credential.oauthCredentials.email,
    });
  }

  private async oauthProvider(
    providerId: string,
  ): Promise<OAuthProviderInterface> {
    const sdk = await import("@cline/sdk");
    if (providerId === "openai-codex") return openAICodexOAuthProvider(sdk);
    if (providerId === "cline" || providerId === "opencode") {
      return clineOAuthProvider(sdk, providerId);
    }
    if (providerId === "oca") return ocaOAuthProvider(sdk);
    throw new Error(`OAuth is not supported for provider ${providerId}`);
  }

  private emitSessionNotice(sessionId: string, message: string) {
    void this.logSession(sessionId, "notice", { message });
    this.events?.emit({ type: "notice", sessionId, payload: { message } });
  }

  private emitSessionError(sessionId: string, message: string) {
    void this.logSession(sessionId, "error", { message });
    this.events?.emit({ type: "error", sessionId, payload: { message } });
  }

  private recordHeadroomCompression(
    sessionId: string,
    usage: HeadroomCompressionUsage,
  ) {
    const totals = nextHeadroomSavings(
      this.sessionHeadroomSavings.get(sessionId),
      usage,
    );
    this.sessionHeadroomSavings.set(sessionId, totals);
    const event: AgentEvent = {
      type: "usage",
      sessionId,
      payload: { usage: headroomUsagePayload(totals) },
    };
    void this.handleSessionEvent(sessionId, event);
    this.events?.emit(event);
  }

  private async logSession(
    sessionId: string,
    message: string,
    payload?: unknown,
    activeContext: Context | undefined = this.agentTelemetry.context(sessionId),
  ) {
    const file = this.sessionLogFiles.get(sessionId);
    if (!file) return;
    const precedingWrite = this.sessionLogWrites.get(sessionId);
    const write = (precedingWrite ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => appendLog(file, message, payload, activeContext));
    this.sessionLogWrites.set(sessionId, write);
    await write;
  }

  private async ensureHeadroomSidecar(
    sessionId: string,
    input: StartSessionInput,
    mode: AgentContextCompressionMode,
  ) {
    if (mode !== "headroom") return undefined;
    const result = await this.headroomSidecar.ensure({
      logger: (message, payload) =>
        this.logSession(sessionId, message, payload),
      logFile: headroomProxyLogPath(input.cwd),
      requestLogFile: headroomRequestLogPath(input.cwd),
    });
    await this.logSession(sessionId, "headroom sidecar selected", {
      headroomBaseUrl: result.baseUrl,
      headroomSource: result.source,
    });
    return result.baseUrl;
  }

  private async disposeCore() {
    const clines = Array.from(this.clines.values());
    this.clines.clear();
    this.sessionBackendKeys.clear();
    this.sessionQualityBaselines.clear();
    this.sessionStartInputs.clear();
    await Promise.allSettled(
      clines.map(async (cline) => (await cline).dispose("Shutting down")),
    );
  }

  private async startDevelopmentSession(input: StartDevelopmentSessionInput) {
    const attachedSession = this.attachedSession(input.resumeSessionId);
    if (attachedSession) {
      await this.logSession(
        attachedSession.sessionId,
        "development session reused",
      );
      return attachedSession;
    }
    const resumeSessionId = input.resumeSessionId?.trim();
    const initialMessages =
      input.autoSendPrompt === false
        ? await this.resumeMessages(resumeSessionId, input.backend)
        : undefined;
    const developmentInput = await developmentUserInput(
      input,
      newAttachmentDirectory(input.cwd),
    );
    return this.startSession({
      apiConnection: input.apiConnection,
      providerId: input.providerId,
      modelId: input.modelId,
      credentialLabel: input.credentialLabel,
      reasoningEffort: input.reasoningEffort,
      contextCompressionMode: input.contextCompressionMode,
      checkpointEnabled: input.checkpointEnabled,
      configExtensions: input.configExtensions,
      disableMcpSettingsTools: input.disableMcpSettingsTools,
      autoApproveWriteTools: true,
      autoSendPrompt: input.autoSendPrompt !== false,
      sessionId: initialMessages?.length ? resumeSessionId : undefined,
      initialMessages,
      mode: "act",
      maxIterations: input.maxIterations ?? developmentMaxIterations(),
      prompt: developmentInput.prompt,
      userFiles: developmentInput.userFiles,
      userImages: developmentInput.userImages,
      pluginPaths: input.pluginPaths,
      cwd: input.cwd,
      workspaceRoot: input.workspaceRoot,
      previewDevtoolsScope: input.previewDevtoolsScope,
      systemPrompt: await buildDevelopmentSystemPrompt(input),
      enableSpawnAgent: true,
      enableAgentTeams: false,
      backend: input.backend,
      executionId: input.executionId,
      storyId: input.storyId,
    });
  }

  private attachmentDirectory(sessionId: string) {
    const logFile = this.sessionLogFiles.get(sessionId);
    if (!logFile) return newAttachmentDirectory(process.cwd());
    return join(
      dirname(dirname(logFile)),
      "attachments",
      sessionId,
      randomUUID(),
    );
  }

  private sendPrompt(
    cline: ClineCore,
    sessionId: string,
    prompt: string,
    attachments: Pick<SendSessionInput, "userFiles" | "userImages"> = {},
  ) {
    const startedAt = Date.now();
    this.agentTelemetry.startModelRequest(sessionId);
    const activeContext = this.agentTelemetry.context(sessionId);
    const result = this.agentTelemetry
      .withinSession(sessionId, () =>
        cline.send({
          sessionId,
          prompt,
          ...(attachments.userImages?.length
            ? { userImages: attachments.userImages }
            : {}),
          ...(attachments.userFiles?.length
            ? { userFiles: attachments.userFiles }
            : {}),
        }),
      )
      .then((result: unknown) => {
        void this.logSession(
          sessionId,
          "send resolved",
          sendResultLogPayload(result, Date.now() - startedAt),
          activeContext,
        );
        const failure = resultFailureMessage(result);
        if (failure) {
          this.agentTelemetry.fail(sessionId, new Error(failure));
          this.emitSessionError(sessionId, failure);
          return result;
        }
        this.events?.emit({
          type: "done",
          sessionId,
          payload: doneResultPayload(result),
        });
        return result;
      })
      .catch((error: unknown) => {
        const message = errorMessage(error);
        void this.logSession(
          sessionId,
          "send failed",
          {
            durationMs: Date.now() - startedAt,
            errorType: errorType(error),
            message,
            status: "failed",
          },
          activeContext,
        );
        this.emitSessionError(sessionId, message);
        throw error;
      });
    void this.logSession(
      sessionId,
      "prompt sent",
      {
        ...promptMetadata(prompt),
      },
      activeContext,
    );
    return result;
  }

  private async prepareSessionCodeGraph(sessionId: string, worktree: string) {
    const provider = this.options.codeReviewGraph;
    if (!provider) return;
    try {
      const status = await provider.status({ worktree });
      this.agentTelemetry.setRepositoryCohorts(
        sessionId,
        status.languages,
        status.files,
      );
      this.emitCodeGraphNotice(sessionId, status);
      if (status.state !== "missing" && status.state !== "stale") return;
      if (!status.available) return;
      void this.updateSessionCodeGraph(sessionId, worktree, provider);
    } catch (error) {
      this.emitCodeGraphUnavailable(sessionId, error);
    }
  }

  private async updateSessionCodeGraph(
    sessionId: string,
    worktree: string,
    provider: CodeReviewGraphProvider,
  ) {
    this.emitSessionNotice(sessionId, "Code graph building");
    try {
      const updatedStatus = await provider.update({ waitMs: 30_000, worktree });
      this.agentTelemetry.setRepositoryCohorts(
        sessionId,
        updatedStatus.languages,
        updatedStatus.files,
      );
      this.emitCodeGraphNotice(sessionId, updatedStatus);
    } catch (error) {
      this.emitCodeGraphUnavailable(sessionId, error);
    }
  }

  private emitCodeGraphUnavailable(sessionId: string, error: unknown) {
    this.emitSessionNotice(
      sessionId,
      `Code graph unavailable: ${errorMessage(error)}`,
    );
  }

  private emitCodeGraphNotice(sessionId: string, status: CodeGraphStatus) {
    if (status.state === "ready") {
      this.emitSessionNotice(sessionId, "Code graph ready");
      return;
    }
    if (status.state === "stale") {
      this.emitSessionNotice(sessionId, "Code graph stale");
      return;
    }
    if (status.state === "building") {
      this.emitSessionNotice(sessionId, "Code graph building");
      return;
    }
    this.emitSessionNotice(sessionId, "Code graph unavailable");
  }
}

function streamingAgentEvent(event: AgentEvent) {
  return event.type === "text" || event.type === "reasoning";
}

function normalizeEvent(
  sessionId: string,
  event: CoreSessionEvent,
): AgentEvent {
  if (event.type === "chunk") {
    const parsed = parseChunkEvent(event.payload.chunk);
    if (event.payload.stream === "agent" && parsed) {
      return normalizeClineAgentPayload(
        parsed,
        event.payload.sessionId,
        parsed,
      );
    }
    return {
      type: event.payload.stream === "agent" ? "text" : "notice",
      sessionId: event.payload.sessionId,
      payload: {
        text: event.payload.chunk,
        stream: event.payload.stream,
        ts: event.payload.ts,
      },
    };
  }
  if (event.type === "hook") return normalizeHookEvent(event, sessionId);
  if (event.type === "ended")
    return {
      type: "done",
      sessionId: event.payload.sessionId,
      payload: event.payload,
    };
  if (event.type === "status")
    return {
      type: "notice",
      sessionId: event.payload.sessionId,
      payload: event.payload,
    };
  if (event.type === "agent_event")
    return normalizeAgentEvent(event, sessionId);
  return { type: "raw", sessionId, payload: event };
}

async function waitForTelemetryCohorts(preparation: Promise<void>) {
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>((resolve) => {
    timeout = setTimeout(resolve, 200);
  });
  await Promise.race([preparation, deadline]);
  if (timeout) clearTimeout(timeout);
}

export function shouldDisplayClineSessionEvent(
  event: CoreSessionEvent,
  spawnAgentActive = false,
) {
  if (event.type === "agent_event") {
    const payload = asRecord(event.payload.event);
    if (stringValue(payload.type) === "usage") return true;
    if (event.payload.teamRole === "teammate") return false;
    if (stringValue(payload.parentAgentId)) return false;
  }
  if (event.type === "hook") {
    if (stringValue(event.payload.parentAgentId)) return false;
  }
  if (spawnAgentActive) {
    return clineSessionSpawnAgentPhase(event) !== undefined;
  }
  return true;
}

function clineSessionSpawnAgentPhase(event: CoreSessionEvent) {
  const tool = clineSessionToolEvent(event);
  if (tool?.toolName !== "spawn_agent") return undefined;
  return tool.phase;
}

function clineSessionToolEvent(event: CoreSessionEvent) {
  if (event.type === "agent_event") {
    const payload = asRecord(event.payload.event);
    if (stringValue(payload.contentType) !== "tool") return undefined;
    const toolName = stringValue(payload.toolName);
    if (!toolName) return undefined;
    const type = stringValue(payload.type);
    if (type === "content_start") {
      return { phase: "started" as const, toolName };
    }
    if (type === "content_end") {
      return { phase: "finished" as const, toolName };
    }
    return undefined;
  }
  if (event.type !== "hook") return undefined;
  const toolName = stringValue(event.payload.toolName);
  if (!toolName) return undefined;
  if (event.payload.hookEventName === "tool_call") {
    return { phase: "started" as const, toolName };
  }
  if (event.payload.hookEventName === "tool_result") {
    return { phase: "finished" as const, toolName };
  }
  return undefined;
}

export function nextSpawnAgentActiveCount(
  current: number,
  phase: "started" | "finished",
) {
  if (phase === "started") return current + 1;
  return Math.max(0, current - 1);
}

function toolPolicies(autoApproveWriteTools: boolean) {
  return Object.fromEntries([
    ...readTools.map((name) => [name, { autoApprove: true }]),
    ...writeTools.map((name) => [name, { autoApprove: autoApproveWriteTools }]),
  ]);
}

export function backendKey(backend?: AgentBackendConfig) {
  if (backend?.key) return backend.key;
  if (!backend) return "local";
  if (backend.mode === "remote") return `remote:${backend.endpoint ?? ""}`;
  if (backend.mode === "hub") return `hub:${backend.endpoint ?? "default"}`;
  return backend.mode;
}

export function coreBackendOptions(
  backend?: AgentBackendConfig,
): ClineCoreOptions {
  if (!backend) return { backendMode: "local" };
  if (backend.mode === "remote") {
    if (!backend.endpoint)
      throw new Error("Remote Cline backend endpoint is required.");
    return {
      backendMode: "remote",
      remote: remoteConnectionOptions(backend, backend.endpoint),
    };
  }
  if (backend.mode === "hub") {
    return {
      backendMode: "hub",
      hub: hubConnectionOptions(backend, backend.endpoint),
    };
  }
  return { backendMode: backend.mode };
}

function remoteConnectionOptions(
  backend: AgentBackendConfig,
  endpoint: string,
): ClineRemoteOptions {
  return {
    endpoint,
    ...(backend.authToken ? { authToken: backend.authToken } : {}),
    ...(backend.cwd ? { cwd: backend.cwd } : {}),
    ...(backend.workspaceRoot ? { workspaceRoot: backend.workspaceRoot } : {}),
    clientType: "blame-desktop",
    displayName: "Blame",
  };
}

function hubConnectionOptions(
  backend: AgentBackendConfig,
  endpoint: string | undefined,
) {
  return {
    ...(endpoint ? { endpoint } : {}),
    ...(backend.authToken ? { authToken: backend.authToken } : {}),
    ...(backend.cwd ? { cwd: backend.cwd } : {}),
    ...(backend.workspaceRoot ? { workspaceRoot: backend.workspaceRoot } : {}),
    clientType: "blame-desktop",
    displayName: "Blame",
  };
}

function initializationConfig(
  input: InitializeProjectInput,
  credential: { apiKey: string; baseUrl: string | null },
  submitTool?: AgentTool,
) {
  return appendProductionConfig({
    providerId: input.providerId,
    modelId: input.modelId,
    apiKey: credential.apiKey,
    baseUrl: credential.baseUrl ?? undefined,
    knownModels: knownOpenAICodexPreviewModels(input.providerId, input.modelId),
    thinking: !!input.reasoningEffort,
    reasoningEffort: input.reasoningEffort,
    systemPrompt: loadPrompt("project-initialization-system"),
    cwd: input.cwd,
    workspaceRoot: input.workspaceRoot,
    enableTools: true,
    enableSpawnAgent: false,
    enableAgentTeams: false,
    extraTools: submitTool ? [submitTool] : undefined,
    maxIterations: 8,
  });
}

function codePracticesConfig(
  input: AnalyzeProjectCodePracticesInput,
  credential: { apiKey: string; baseUrl: string | null },
  submitTool: AgentTool,
) {
  return appendProductionConfig({
    providerId: input.providerId,
    modelId: input.modelId,
    apiKey: credential.apiKey,
    baseUrl: credential.baseUrl ?? undefined,
    knownModels: knownOpenAICodexPreviewModels(input.providerId, input.modelId),
    thinking: !!input.reasoningEffort,
    reasoningEffort: input.reasoningEffort,
    systemPrompt: loadPrompt("project-code-practices-system"),
    cwd: input.cwd,
    workspaceRoot: input.workspaceRoot,
    enableTools: true,
    enableSpawnAgent: false,
    enableAgentTeams: false,
    extraTools: [submitTool],
    maxIterations: 4,
  });
}

function projectCodePracticesSubmitTool(): StructuredResultSubmitTool {
  const submit: StructuredResultSubmitTool = {
    input: undefined,
    tool: {
      name: "submit_project_code_practices",
      description: "Submit the complete project code practice analysis.",
      inputSchema: projectCodePracticesResultSchema,
      lifecycle: { completesRun: true },
      execute(input: unknown) {
        submit.input = input;
        return { accepted: true };
      },
    },
  };
  return submit;
}

function projectInitializationSubmitTool(): StructuredResultSubmitTool {
  const submit: StructuredResultSubmitTool = {
    input: undefined,
    tool: {
      name: "submit_project_initialization",
      description:
        "Submit the complete Blame project initialization result for validation.",
      inputSchema: projectInitializationResultSchema,
      lifecycle: { completesRun: true },
      execute(input: unknown) {
        submit.input = input;
        return { accepted: true };
      },
    },
  };
  return submit;
}

async function collectProjectInitializationAttempt(
  cline: ClineCore,
  session: RuntimeClineResult,
  submitTool: StructuredResultSubmitTool,
): Promise<ProjectInitializationAttempt> {
  const submittedInput =
    submitTool.input ??
    projectInitializationInputFromResult(session.result) ??
    (await projectInitializationInputFromMessages(cline, session.sessionId));
  const result = submittedInput ?? session.result?.text;
  if (!result)
    throw new Error("Project initialization agent did not return a result");
  return { result, sessionId: session.sessionId, submittedInput };
}

function parseProjectInitializationAttempt(
  attempt: ProjectInitializationAttempt,
  scan: ProjectInitializationScan,
  input: InitializeProjectInput,
) {
  const initialization = attempt.submittedInput
    ? parseProjectInitializationPayload(
        attempt.submittedInput,
        scan,
        input.preferences,
      )
    : parseProjectInitializationResult(
        String(attempt.result),
        scan,
        input.preferences,
      );
  return { sessionId: attempt.sessionId, ...initialization };
}

function parsedCodePracticesAttempt(
  attempt: { input: unknown; sessionId: string },
  scan: ProjectCodePracticesScan,
): AnalyzeProjectCodePracticesResult {
  return {
    sessionId: attempt.sessionId,
    practices: resolveProjectCodePracticesResult(attempt.input, scan.commits),
  };
}

function projectInitializationRepairAttempt(
  session: RuntimeClineResult,
): ProjectInitializationRepairAttempt {
  const text = session.result?.text;
  if (!text)
    throw new Error(
      "Project initialization repair agent did not return a result",
    );
  return { sessionId: session.sessionId, text };
}

function parseProjectInitializationRepairAttempt(
  attempt: ProjectInitializationRepairAttempt,
  scan: ProjectInitializationScan,
) {
  return {
    sessionId: attempt.sessionId,
    ...parseProjectInitializationRepairResult(attempt.text, scan),
  };
}

function initializationCorrection(
  previousResult: unknown,
  error: unknown,
): InitializationCorrection {
  const serializedResult =
    typeof previousResult === "string"
      ? previousResult
      : JSON.stringify(previousResult);
  return {
    previousResult: serializedResult ?? String(previousResult),
    validationError: errorMessage(error),
  };
}

function runtimeTools(
  options: RuntimeOptions,
  worktree?: string,
  previewDevtoolsScope?: string,
) {
  const tools = [
    previewDevtoolsTool(options, previewDevtoolsScope),
    previewContainerLogsTool(options, worktree),
    ...codeReviewGraphTools(options.codeReviewGraph, worktree),
  ].filter((tool): tool is AgentTool => Boolean(tool));
  return tools.length ? tools : undefined;
}

function previewDevtoolsTool(
  options: RuntimeOptions,
  previewDevtoolsScope?: string,
): AgentTool | undefined {
  if (!options.previewDevtools) return undefined;
  return {
    name: "get_preview_devtools",
    description:
      "Get this agent session's Blame preview Chrome DevTools MCP server configuration and current preview URL.",
    inputSchema: {
      type: "object",
      properties: {
        timeoutMs: {
          type: "number",
          description:
            "Maximum time to wait for the Blame preview BrowserView to become ready, in milliseconds.",
        },
      },
      additionalProperties: false,
    },
    async execute(input: unknown) {
      const previewInput = previewDevtoolsInput(input, previewDevtoolsScope);
      const target = await options.previewDevtools?.(previewInput);
      if (!target?.available) {
        return {
          available: false,
          reason: previewDevtoolsScope
            ? "No Blame preview is currently loaded for this agent session."
            : "No active Blame preview is currently loaded.",
          waitedMs: previewInput.timeoutMs,
          recommendation:
            "The preview may still be initializing. Call this tool again before concluding that preview access is unavailable.",
        };
      }
      return {
        ...target,
        usage:
          "Use the returned mcpServer command and args to connect chrome-devtools-mcp to this preview target.",
      };
    },
  };
}

function previewDevtoolsInput(
  input: unknown,
  scope: string | undefined,
): PreviewDevtoolsTargetInput {
  const record = asRecord(input);
  const timeoutMs = Number(record.timeoutMs);
  return {
    ...(scope ? { scope } : {}),
    ...(Number.isFinite(timeoutMs) ? { timeoutMs } : {}),
  };
}

function previewContainerLogsTool(
  options: RuntimeOptions,
  worktree?: string,
): AgentTool | undefined {
  if (!options.previewContainerLogs || !worktree) return undefined;
  return {
    name: "get_preview_container_logs",
    description:
      "Get the Blame preview container logs for the current worktree. Returns available compose services, the selected service, recent stdout and stderr, and whether the logs came from live containers or the archived setup log. Use this read-only tool when debugging preview runtime, server, build, API, or database failures. Defaults to the first preview service and 120 tail lines.",
    inputSchema: previewContainerLogsInputSchema(),
    async execute(input: unknown, context: ToolContext) {
      try {
        return await options.previewContainerLogs?.({
          ...previewContainerLogsInput(input),
          signal: context.signal,
          worktree,
        });
      } catch (error) {
        return {
          isError: true,
          output: { error: errorMessage(error) },
        };
      }
    },
  };
}

function previewContainerLogsInputSchema() {
  return {
    type: "object",
    properties: {
      service: {
        type: "string",
        description:
          "Optional compose service name to read logs for. When omitted, Blame selects the first preview service, matching the preview drawer.",
      },
      tailLines: {
        type: "number",
        description:
          "Maximum number of recent log lines to return from live containers. Defaults to 120 and is capped at 1000.",
      },
    },
    additionalProperties: false,
  };
}

function previewContainerLogsInput(
  input: unknown,
): Omit<PreviewContainerLogsInput, "signal" | "worktree"> {
  const record = asRecord(input);
  const service = stringValue(record.service);
  return {
    ...(service ? { service } : {}),
    tailLines: boundedNumber(record.tailLines, 1, 1000) ?? 120,
  };
}

async function projectInitializationInputFromMessages(
  cline: ClineCore,
  sessionId: string,
) {
  try {
    return projectInitializationInputFromMessageList(
      await cline.readMessages(sessionId),
    );
  } catch {
    return undefined;
  }
}

function projectInitializationInputFromResult(result: unknown) {
  const payload = asRecord(result);
  const toolCalls = Array.isArray(payload.toolCalls) ? payload.toolCalls : [];
  for (const call of toolCalls) {
    const record = asRecord(call);
    if (record.name === "submit_project_initialization") {
      return record.input;
    }
  }
  return projectInitializationInputFromMessageList(payload.messages);
}

function projectInitializationInputFromMessageList(value: unknown) {
  const messages = Array.isArray(value) ? value : asRecord(value).messages;
  if (!Array.isArray(messages)) return undefined;
  for (const message of messages) {
    const content = asRecord(message).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const input = projectInitializationInputFromMessagePart(part);
      if (input) return input;
    }
  }
  return undefined;
}

function projectInitializationInputFromMessagePart(value: unknown) {
  const part = asRecord(value);
  const name =
    stringValue(part.name) ??
    stringValue(part.toolName) ??
    stringValue(asRecord(part.toolCall).name) ??
    stringValue(asRecord(part.toolCall).toolName);
  if (name !== "submit_project_initialization") return undefined;
  return part.input ?? asRecord(part.toolCall).input;
}

function initializationRepairConfig(
  input: RepairProjectInitializationInput,
  credential: { apiKey: string; baseUrl: string | null },
) {
  return appendProductionConfig({
    providerId: input.providerId,
    modelId: input.modelId,
    apiKey: credential.apiKey,
    baseUrl: credential.baseUrl ?? undefined,
    knownModels: knownOpenAICodexPreviewModels(input.providerId, input.modelId),
    thinking: !!input.reasoningEffort,
    reasoningEffort: input.reasoningEffort,
    systemPrompt: loadPrompt("project-initialization-repair-system"),
    cwd: input.cwd,
    workspaceRoot: input.workspaceRoot,
    enableTools: false,
    enableSpawnAgent: false,
    enableAgentTeams: false,
    maxIterations: 4,
  });
}

function initializationImpactConfig(
  input: AssessProjectInitializationImpactInput,
  credential: { apiKey: string; baseUrl: string | null },
) {
  return appendProductionConfig({
    providerId: input.providerId,
    modelId: input.modelId,
    apiKey: credential.apiKey,
    baseUrl: credential.baseUrl ?? undefined,
    knownModels: knownOpenAICodexPreviewModels(input.providerId, input.modelId),
    thinking: !!input.reasoningEffort,
    reasoningEffort: input.reasoningEffort,
    systemPrompt: loadPrompt("project-initialization-impact-system"),
    cwd: input.cwd,
    workspaceRoot: input.workspaceRoot,
    enableTools: false,
    enableSpawnAgent: false,
    enableAgentTeams: false,
    maxIterations: 4,
  });
}

function commitMessageConfig(
  input: CommitMessageRuntimeInput,
  credential: { apiKey: string; baseUrl: string | null },
) {
  return appendProductionConfig({
    providerId: input.providerId,
    modelId: input.modelId,
    apiKey: credential.apiKey,
    baseUrl: credential.baseUrl ?? undefined,
    knownModels: knownOpenAICodexPreviewModels(input.providerId, input.modelId),
    thinking: !!input.reasoningEffort,
    reasoningEffort: input.reasoningEffort,
    systemPrompt: developmentPracticePrompt(
      input.codePractices ?? [],
      "commit_message_convention",
    ),
    cwd: input.worktree,
    workspaceRoot: input.worktree,
    enableTools: false,
    enableSpawnAgent: false,
    enableAgentTeams: false,
    maxIterations: 4,
  });
}

function mergeConflictConfig(
  input: MergeConflictRuntimeInput,
  credential: { apiKey: string; baseUrl: string | null },
) {
  return appendProductionConfig({
    providerId: input.providerId,
    modelId: input.modelId,
    apiKey: credential.apiKey,
    baseUrl: credential.baseUrl ?? undefined,
    knownModels: knownOpenAICodexPreviewModels(input.providerId, input.modelId),
    thinking: !!input.reasoningEffort,
    reasoningEffort: input.reasoningEffort,
    systemPrompt: loadPrompt("merge-conflict-resolution"),
    cwd: input.worktree,
    workspaceRoot: input.worktree,
    enableTools: true,
    enableSpawnAgent: false,
    enableAgentTeams: false,
    maxIterations: 16,
  });
}

function initializationPrompt(
  scan: ProjectInitializationScan,
  correction?: InitializationCorrection,
) {
  if (!correction) return projectInitializationPrompt(scan);
  return projectInitializationCorrectionPrompt(scan, correction);
}

function codePracticesPrompt(
  scan: ProjectCodePracticesScan,
  correction?: InitializationCorrection,
) {
  if (!correction) return projectCodePracticesPrompt(scan);
  return projectCodePracticesCorrectionPrompt(scan, correction);
}

export async function developmentUserInput(
  input: DevelopmentPromptInput,
  attachmentDirectory: string,
) {
  const attachments = await fileAttachmentInputs(
    [
      ...(input.fileAttachments ?? []),
      ...(input.feedbackFileAttachments ?? []),
    ],
    attachmentDirectory,
  );
  if (input.feedbackOnly) {
    return {
      prompt: developmentFeedbackPrompt(input, attachments),
      userFiles: attachments.userFiles,
      userImages: attachments.userImages,
    };
  }
  return {
    prompt: developmentStoryPrompt(input, attachments),
    userFiles: attachments.userFiles,
    userImages: attachments.userImages,
  };
}

function developmentFeedbackPrompt(
  input: DevelopmentPromptInput,
  attachments: DevelopmentAttachmentInput,
) {
  const prompt = [input.feedback?.trim()].filter(Boolean);
  const feedbackAttachments = codeSelectionAttachmentsMarkdown(
    input.feedbackCodeSelectionAttachments,
  );
  if (feedbackAttachments) prompt.push(feedbackAttachments);
  const feedbackFiles = fileAttachmentReferences(input.feedbackFileAttachments);
  if (feedbackFiles) prompt.push(feedbackFiles);
  const attachmentReferences = clineAttachmentReferences(attachments);
  if (attachmentReferences) prompt.push(attachmentReferences);
  return prompt.join("\n\n");
}

function developmentStoryPrompt(
  input: DevelopmentPromptInput,
  attachments: DevelopmentAttachmentInput = { userFiles: [], userImages: [] },
) {
  const prompt = [`Backlog item: ${input.title}`, "", input.summary];
  const storyAttachments = codeSelectionAttachmentsMarkdown(
    input.codeSelectionAttachments,
  );
  if (storyAttachments) {
    prompt.push("", "Attached code selections:", "", storyAttachments);
  }
  const storyFiles = fileAttachmentReferences(input.fileAttachments);
  if (storyFiles) {
    prompt.push("", "Attached files:", "", storyFiles);
  }
  if (input.feedback?.trim()) {
    prompt.push("", "Review feedback:", "", input.feedback.trim());
  }
  const feedbackAttachments = codeSelectionAttachmentsMarkdown(
    input.feedbackCodeSelectionAttachments,
  );
  if (feedbackAttachments) {
    prompt.push(
      "",
      "Review feedback code selections:",
      "",
      feedbackAttachments,
    );
  }
  const feedbackFiles = fileAttachmentReferences(input.feedbackFileAttachments);
  if (feedbackFiles) {
    prompt.push("", "Review feedback files:", "", feedbackFiles);
  }
  if (attachments.userImages.length) {
    prompt.push(
      "",
      `Images attached for model vision: ${attachments.userImages.length}`,
    );
  }
  if (attachments.userFiles.length) {
    prompt.push(
      "",
      "Files attached for Cline context:",
      "",
      attachments.userFiles.join("\n"),
    );
  }
  prompt.push(
    "",
    "Work in the current worktree when code changes are clearly required.",
    "If the request is a question, analysis, opinion, explanation, or review request, inspect the project if useful and answer in Markdown without editing files.",
    "Only modify files when the request explicitly asks for implementation or when a concrete code change is necessary to satisfy it.",
    "When browser verification is useful, call get_preview_devtools and wait for this session's Blame preview to become ready before deciding preview access is unavailable.",
  );
  return prompt.join("\n");
}

function clineAttachmentReferences(attachments: DevelopmentAttachmentInput) {
  const references: string[] = [];
  if (attachments.userImages.length) {
    references.push(
      `Images attached for model vision: ${attachments.userImages.length}`,
    );
  }
  if (attachments.userFiles.length) {
    references.push(
      `Files attached for Cline context: ${attachments.userFiles.length}`,
    );
  }
  return references.join("\n");
}

function codeSelectionAttachmentsMarkdown(
  attachments: StartDevelopmentSessionInput["codeSelectionAttachments"],
) {
  if (!attachments?.length) return "";
  return attachments.map(codeSelectionAttachmentMarkdown).join("\n\n");
}

function codeSelectionAttachmentMarkdown(
  attachment: NonNullable<
    StartDevelopmentSessionInput["codeSelectionAttachments"]
  >[number],
) {
  const fence = markdownFence(attachment.content);
  return [
    `### ${attachment.path} (${codeSelectionLineLabel(attachment)})`,
    "",
    fence,
    attachment.content,
    fence,
  ].join("\n");
}

function codeSelectionLineLabel(
  attachment: Pick<
    NonNullable<
      StartDevelopmentSessionInput["codeSelectionAttachments"]
    >[number],
    "endLine" | "startLine"
  >,
) {
  if (attachment.startLine === attachment.endLine)
    return `Line ${attachment.startLine}`;
  return `Lines ${attachment.startLine}-${attachment.endLine}`;
}

function markdownFence(content: string) {
  const longestFence = content
    .match(/`{3,}/g)
    ?.reduce((longest, fence) => Math.max(longest, fence.length), 2);
  return "`".repeat((longestFence ?? 2) + 1);
}

function fileAttachmentReferences(
  attachments: StartDevelopmentSessionInput["fileAttachments"],
) {
  if (!attachments?.length) return "";
  return attachments.map(fileAttachmentReference).join("\n");
}

function fileAttachmentReference(
  attachment: NonNullable<
    StartDevelopmentSessionInput["fileAttachments"]
  >[number],
) {
  const label = `${attachment.name} (${attachment.type || "application/octet-stream"}, ${attachment.size} bytes)`;
  if (!attachment.aiContextMarkdown?.trim()) return `- ${label}`;
  const fence = markdownFence(attachment.aiContextMarkdown);
  return [
    `- ${label}`,
    "",
    `${fence}markdown`,
    attachment.aiContextMarkdown.trim(),
    fence,
  ].join("\n");
}

async function fileAttachmentInputs(
  attachments: NonNullable<StartDevelopmentSessionInput["fileAttachments"]>,
  attachmentDirectory: string,
) {
  const userImages: string[] = [];
  const userFiles: string[] = [];
  await Promise.all(
    attachments.map(async (attachment) => {
      if (attachment.type.startsWith("image/")) {
        userImages.push(`data:${attachment.type};base64,${attachment.content}`);
        return;
      }
      userFiles.push(
        await writeFileAttachment(attachment, attachmentDirectory),
      );
    }),
  );
  return { userFiles, userImages };
}

async function writeFileAttachment(
  attachment: NonNullable<
    StartDevelopmentSessionInput["fileAttachments"]
  >[number],
  attachmentDirectory: string,
) {
  await mkdir(attachmentDirectory, { recursive: true });
  const path = join(attachmentDirectory, attachmentFileName(attachment.name));
  await writeFile(path, Buffer.from(attachment.content, "base64"));
  return path;
}

function attachmentFileName(name: string) {
  const normalizedName = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${randomUUID()}-${normalizedName || "attachment"}`;
}

function newAttachmentDirectory(cwd: string) {
  return join(cwd, attachmentDirectoryName, randomUUID());
}

export async function buildDevelopmentSystemPrompt(
  input: StartDevelopmentSessionInput,
) {
  const metadata = await buildWorkspaceMetadata(input.cwd);
  const practices = input.codePractices ?? [];
  return renderPrompt(loadPrompt("code-agent-system"), {
    BLAME_PRACTICES: developmentPracticePrompts(practices),
    BLAME_SPECIALISTS: blameSpecialistAgentsSystemPrompt(),
    CURRENT_DATE: new Date().toISOString().slice(0, 10),
    CWD: input.cwd,
    IDE_NAME: "Blame",
    PLATFORM_NAME: process.platform,
    WORKSPACE_METADATA: metadata,
    WORKSPACE_NAME: basename(input.workspaceRoot),
    WORKSPACE_ROOT: input.workspaceRoot,
  });
}

function developmentPracticePrompts(
  practices: ProjectCodePracticePreference[],
) {
  return [
    developmentPracticePrompt(practices, "coding_style"),
    developmentPracticePrompt(practices, "layered_architecture"),
    developmentPracticePrompt(practices, "unit_tests"),
  ].join("\n\n");
}

function renderPrompt(template: string, values: Record<string, string>) {
  return template.replace(/{{([A-Z_]+)}}/g, (placeholder, key) => {
    return values[key] ?? placeholder;
  });
}

async function newProjectGenerationConfig(
  input: StartNewProjectGenerationInput,
  credential: { apiKey: string; baseUrl: string | null },
  sessionId: string,
  productionConfig: ReturnType<typeof loadProductionConfig>,
) {
  const metadata = await buildWorkspaceMetadata(input.cwd);
  return appendProductionConfig({
    sessionId,
    providerId: input.providerId,
    modelId: input.modelId,
    apiKey: credential.apiKey,
    baseUrl: credential.baseUrl ?? undefined,
    knownModels: knownOpenAICodexPreviewModels(input.providerId, input.modelId),
    thinking: !!input.reasoningEffort,
    reasoningEffort: input.reasoningEffort,
    systemPrompt: getClineDefaultSystemPrompt({
      ide: "Blame",
      metadata,
      mode: "yolo",
      platform: process.platform,
      providerId: input.providerId,
      rules: mergeRulesForSystemPrompt(
        undefined,
        loadPrompt("new-project-generation-system"),
      ),
      workspaceName: input.projectName,
      workspaceRoot: input.workspaceRoot,
    }),
    cwd: input.cwd,
    workspaceRoot: input.workspaceRoot,
    mode: "yolo",
    maxIterations: newProjectGenerationMaxIterations(),
    compaction: blameCompactionConfig(productionConfig),
    enableTools: true,
    enableSpawnAgent: false,
    enableAgentTeams: false,
    extensionContext: {
      client: { name: "blame" },
      logger: productionLogger,
      workspace: {
        cwd: input.cwd,
        ide: "Blame",
        mode: "yolo",
        platform: process.platform,
        rootPath: input.workspaceRoot,
        workspaceName: input.projectName,
      },
    },
  });
}

function newProjectGenerationPrompt(input: StartNewProjectGenerationInput) {
  const authRequested = input.configuration.advancedOptions.includes("auth");
  return [
    `Generate a new Blame project named ${input.projectName}.`,
    "",
    "The current working directory is already the empty target project directory. Initialize the codebase in this directory; do not create a nested project folder unless the selected architecture explicitly needs sub-app folders such as apps/web.",
    "",
    "Scope constraints:",
    "- Initialize the selected framework starter with canonical CLI commands whenever possible.",
    "- Keep the generated app close to the default framework starter.",
    "- Do not create a custom homepage, dashboard, demo feature, CRUD flow, domain model, mock data, or marketing content.",
    "- Do not add authentication, users, sessions, protected routes, or authorization unless auth is requested.",
    authRequested
      ? "- Auth is requested: add only the smallest working auth scaffold appropriate for the selected stack."
      : "- Auth is not requested: do not add auth-related dependencies, screens, routes, schemas, or services.",
    "- Add only files required by selected advanced options.",
    "- Do not downgrade or upgrade framework versions after the CLI creates the starter.",
    "- Keep framework config file extensions compatible with the installed framework version.",
    "- Do not chase build, lint, peer dependency, or framework warnings during project creation.",
    "- Do not read files at the end to verify coherence. Stop after dependency installation and final required file writes.",
    "- After all scaffold and installation commands, create or update the root .gitignore without replacing existing entries. It must exclude dependencies, framework build output, Blame runtime artifacts, and runtime .env files while keeping .env templates trackable.",
    "",
    "Wizard brief (normalized JSON):",
    JSON.stringify(
      {
        projectName: input.projectName,
        targetPath: input.cwd,
        configuration: input.configuration,
      },
      null,
      2,
    ),
    "",
    "Compatibility and recommendation rules:",
    "- Treat this normalized wizard configuration as the user's source of intent.",
    "- Respect frontend/backend/database/ORM/UI compatibility implied by the selected values.",
    "- If an exact combination has no mature canonical integration, choose the smallest coherent starter and document the trade-off in README.md.",
    "- Advanced options are explicit requirements when present: monorepo, auth, unitTests, e2eTests, githubActions, envExample, readme, typescriptAlias, standardScripts.",
    "- Ignore docker, dockerCompose, and blamePreview during project creation because Blame handles them during initialization.",
    "- Blame will generate setup and Docker Compose preview artifacts after creation through a separate initialization agent.",
    "- Do not create .blame/setup.sh, setup.sh, docker-compose.yml, compose.yml, or Blame preview metadata.",
    "",
    "Blame readiness requirements:",
    "- Make dependency installation non-interactive and reproducible.",
    "- Provide scripts named dev and build; also lint/test when requested or when quality/test options require them.",
    "- Provide .env.example, README.md, tests, GitHub Actions, aliases, and auth only when requested.",
    "- Avoid blocking prompts; pass non-interactive flags or create files manually when CLIs are interactive.",
    "- Do not use sudo and do not require global installs.",
    "",
    "Verification before completion:",
    "- Install dependencies once using the selected package manager/runtime.",
    "- Do not run build, lint, test, dev servers, preview commands, or long-running processes.",
    "- Do not inspect generated source files after installation unless dependency installation failed and the exact file must be fixed.",
    "- Read and finalize the root .gitignore after commands have completed.",
    "- Fix only errors that prevent the framework starter from being created or dependencies from being installed.",
    "- Finish with a concise summary of scaffolded files, dependency installation result, and any caveats.",
  ].join("\n");
}

function newProjectGenerationMaxIterations() {
  const value = Number(process.env.BLAME_AGENT_NEW_PROJECT_MAX_ITERATIONS);
  return Number.isFinite(value) && value > 0 ? value : 16;
}

async function generatedProjectLooksReady(cwd: string) {
  return (
    (await fileExists(join(cwd, "package.json"))) ||
    (await fileExists(join(cwd, "apps", "web", "package.json")))
  );
}

async function fileExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function createBlameSessionId() {
  return `${Date.now()}_${randomUUID().replaceAll("-", "").slice(0, 5)}`;
}

function extensionContext(input: StartSessionInput) {
  return {
    client: { name: "blame" },
    logger: productionLogger,
    workspace: {
      cwd: input.cwd,
      ide: "Blame",
      mode: input.mode ?? "act",
      platform: process.platform,
      rootPath: input.workspaceRoot,
      workspaceName: basename(input.workspaceRoot),
    },
  };
}

function developmentPracticePrompt(
  practices: ProjectCodePracticePreference[],
  practice: ProjectCodePracticeKey,
) {
  const enabled = practices.find((item) => item.practice === practice)?.enabled;
  if (practice === "coding_style") {
    return loadPrompt(
      `practices/coding-style/${enabled ? "standard" : "match-codebase"}`,
    );
  }
  if (practice === "layered_architecture") {
    return loadPrompt(
      `practices/architecture/${enabled ? "standard" : "match-codebase"}`,
    );
  }
  if (practice === "commit_message_convention") {
    return loadPrompt(
      `practices/commit-message/${enabled ? "standard" : "match-codebase"}`,
    );
  }
  return loadPrompt(
    `practices/unit-tests/${enabled ? "standard" : "disabled"}`,
  );
}

async function assertGitRepository(cwd: string) {
  await git(cwd, ["rev-parse", "--show-toplevel"]);
}

async function currentGitBranch(cwd: string) {
  return git(cwd, ["branch", "--show-current"]);
}

async function validateMergeBranches(
  input: ApproveAndMergeInput,
  targetBranch: string,
) {
  if (!targetBranch)
    throw new Error("Unable to detect the active project branch.");
  const storyBranch = await currentGitBranch(input.worktree);
  if (storyBranch !== input.storyBranch) {
    throw new Error(
      `Story worktree is on ${storyBranch}, expected ${input.storyBranch}.`,
    );
  }
  if (targetBranch === input.storyBranch) {
    throw new Error("Story branch and target branch must be different.");
  }
}

async function optionalGitUpstream(cwd: string) {
  try {
    const upstream = await git(cwd, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{u}",
    ]);
    return parseUpstream(upstream);
  } catch {
    return undefined;
  }
}

async function cleanGitStatus(cwd: string) {
  const status = await git(cwd, ["status", "--porcelain"]);
  return !status.trim();
}

async function integrationWorktree(cwd: string, targetBranch: string) {
  const directory = integrationWorktreePath(cwd, targetBranch);
  await rm(directory, { force: true, recursive: true });
  await git(cwd, ["worktree", "prune"]);
  await git(cwd, ["worktree", "add", "--detach", directory, targetBranch]);
  return directory;
}

async function advanceTargetBranch(
  cwd: string,
  targetBranch: string,
  storyBranch: string,
) {
  const activeBranch = await currentGitBranch(cwd);
  if (activeBranch !== targetBranch) {
    throw new Error(
      `Active project branch changed to ${activeBranch}, expected ${targetBranch}.`,
    );
  }
  await git(cwd, ["merge", "--ff-only", storyBranch]);
}

async function pullIntegrationWorktree(cwd: string, upstream?: GitUpstream) {
  if (!upstream) return;
  await git(cwd, ["fetch", upstream.remote, upstream.branch]);
  await git(cwd, [
    "merge",
    "--ff-only",
    `${upstream.remote}/${upstream.branch}`,
  ]);
}

async function pushIntegrationWorktree(
  cwd: string,
  upstream: GitUpstream | undefined,
  logFile: string,
) {
  if (!upstream) {
    await appendLog(logFile, "approve merge push skipped", {
      reason: "missing_upstream",
    });
    return;
  }
  await git(cwd, ["push", upstream.remote, `HEAD:${upstream.branch}`]);
}

async function removeIntegrationWorktree(
  repositoryRoot: string,
  worktree: string,
) {
  try {
    await git(repositoryRoot, ["worktree", "remove", "--force", worktree]);
  } catch {
    await rm(worktree, { force: true, recursive: true });
    await git(repositoryRoot, ["worktree", "prune"]).catch(() => undefined);
  }
}

type GitUpstream = {
  branch: string;
  remote: string;
};

function parseUpstream(value: string): GitUpstream {
  const [remote, ...branchParts] = value.split("/");
  const branch = branchParts.join("/");
  if (!remote || !branch)
    throw new Error("Active project branch upstream is invalid.");
  return { branch, remote };
}

function integrationWorktreePath(repositoryRoot: string, targetBranch: string) {
  return join(
    dirname(repositoryRoot),
    ".blame-worktrees",
    basename(repositoryRoot),
    ".merge",
    branchPathSlug(targetBranch),
  );
}

function branchPathSlug(branch: string) {
  return (
    branch
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "target"
  );
}

async function hasMergeConflicts(cwd: string) {
  return Boolean((await mergeConflictFiles(cwd)).length);
}

async function mergeConflictFiles(cwd: string) {
  const files = await git(cwd, ["diff", "--name-only", "--diff-filter=U"]);
  return files.split("\n").filter(Boolean);
}

async function commitMessagePrompt(input: CommitMessageRuntimeInput) {
  const paths = commitMessagePaths(input);
  const [status, changedFiles, diffStat, log] = await Promise.all([
    storyStatus(input.worktree, "--porcelain", paths),
    storyChangedFiles(input.worktree, paths),
    storyDiffStat(input.worktree, paths),
    git(input.worktree, ["log", "-12", "--pretty=%s"]),
  ]);
  const title = input.title || "Git changes";
  const summary =
    input.summary ||
    "Generate a concise commit message for the selected changes.";
  return [
    `Backlog item: ${title}`,
    "",
    summary,
    "",
    `Git status:\n${truncateText(status, 8_000)}`,
    "",
    `Selected paths:\n${truncateText(paths.join("\n"), 8_000)}`,
    "",
    `Changed files:\n${truncateText(changedFiles, 12_000)}`,
    "",
    `Diff stat:\n${truncateText(diffStat, 12_000)}`,
    "",
    `Recent commits:\n${truncateText(log, 8_000)}`,
  ].join("\n");
}

async function storyChangedFiles(cwd: string, paths = ["."]) {
  return git(cwd, [
    "diff",
    "--no-ext-diff",
    "--name-status",
    "HEAD",
    "--",
    ...paths,
    ...runtimeArtifactPathspecs,
  ]);
}

async function storyDiffStat(cwd: string, paths = ["."]) {
  return git(cwd, [
    "diff",
    "--no-ext-diff",
    "--stat",
    "HEAD",
    "--",
    ...paths,
    ...runtimeArtifactPathspecs,
  ]);
}

async function fallbackCommitMessage(input: CommitMessageRuntimeInput) {
  const paths = commitMessagePaths(input);
  const [status, log] = await Promise.all([
    storyStatus(input.worktree, "--porcelain", paths),
    git(input.worktree, ["log", "-12", "--pretty=%s"]),
  ]);
  const files = statusFileNames(status);
  const standardConvention = commitMessageConventionEnabled(input);
  const subject = fallbackCommitSubject(
    input.title || "selected changes",
    files,
  );
  const bracketPrefix = dominantBracketPrefix(log);
  if (!standardConvention && bracketPrefix) {
    return limitCommitMessage(`${bracketPrefix} ${subject}`);
  }
  const scope = commitScope(files);
  const type = commitType(files);
  return limitCommitMessage(`${type}${scope ? `(${scope})` : ""}: ${subject}`);
}

function commitMessagePaths(input: CommitMessageRuntimeInput) {
  if (!("selectedPaths" in input)) return ["."];
  const paths = input.selectedPaths?.filter(Boolean) ?? [];
  return paths.length ? paths : ["."];
}

function commitMessageFromAgentResult(result: unknown) {
  const payload = asRecord(result);
  return (
    firstTextLine(payload.text) ??
    firstTextLine(payload.outputText) ??
    firstTextLine(payload.message)
  );
}

function commitMessageConventionEnabled(input: CommitMessageRuntimeInput) {
  return (
    input.codePractices?.find(
      (item) => item.practice === "commit_message_convention",
    )?.enabled ?? false
  );
}

function dominantBracketPrefix(log: string) {
  const prefixes = log
    .split("\n")
    .map((line) => line.match(/^(\[[^\]]+\])/)?.[1])
    .filter(isString);
  const counts = new Map<string, number>();
  prefixes.forEach((prefix) =>
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1),
  );
  return [...counts.entries()].find(([, count]) => count >= 2)?.[0];
}

function statusFileNames(status: string) {
  return status.split("\n").map(statusFileName).filter(isString);
}

function statusFileName(line: string) {
  const file = line.slice(3).trim();
  return file.includes(" -> ") ? file.split(" -> ").at(-1) : file;
}

function commitScope(files: string[]) {
  const firstFile = files.find(Boolean);
  if (!firstFile) return undefined;
  const parts = firstFile.split("/");
  if (parts[0] === "packages" && parts[1]) return parts[1];
  if (parts[0] === "src" && parts[1]) return parts[1];
  return parts[0]?.replace(/\.[^.]+$/g, "");
}

function commitType(files: string[]) {
  if (
    files.length &&
    files.every((file) => /\.(test|spec)\.[jt]sx?$/.test(file))
  )
    return "test";
  if (files.length && files.every((file) => /\.(md|mdx|txt)$/.test(file)))
    return "docs";
  if (files.some((file) => /(^|\/)(package\.json|pnpm-lock\.yaml)$/.test(file)))
    return "build";
  return "fix";
}

function limitCommitMessage(message: string) {
  return message.length <= 74
    ? message
    : message.slice(0, 74).replace(/\s+\S*$/, "");
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

async function mergeConflictPrompt(
  input: MergeConflictRuntimeInput,
  targetBranch: string,
  attempt: number,
) {
  const [status, files] = await Promise.all([
    storyStatus(input.worktree, "--short"),
    git(input.worktree, ["diff", "--name-only", "--diff-filter=U"]),
  ]);
  const title = input.title || "Current Git merge conflict";
  const summary = input.summary || "Resolve the active merge conflicts.";
  const storyBranch =
    "storyBranch" in input && input.storyBranch
      ? input.storyBranch
      : await currentGitBranch(input.worktree);
  return [
    `Backlog item: ${title}`,
    "",
    summary,
    "",
    `Story branch: ${storyBranch || "HEAD"}`,
    `Target branch: ${targetBranch}`,
    `Resolution attempt: ${attempt} of ${maxMergeConflictResolutionAttempts}`,
    "",
    `Conflicted files:\n${files}`,
    "",
    `Git status:\n${truncateText(status, 8_000)}`,
  ].join("\n");
}

async function storyStatus(
  cwd: string,
  format: "--porcelain" | "--short",
  paths = ["."],
) {
  const envPathspecs = (await changedRuntimeEnvPaths(cwd)).map(
    (path) => `:!${path}`,
  );
  return git(cwd, [
    "status",
    format,
    "--",
    ...paths,
    ...runtimeArtifactPathspecs,
    ...envPathspecs,
  ]);
}

async function addStoryChanges(cwd: string) {
  const envPaths = await changedRuntimeEnvPaths(cwd);
  await git(cwd, ["add", "-A", "--", "."]);
  await git(cwd, [
    "reset",
    "--quiet",
    "--",
    ...runtimeArtifactPaths,
    ...envPaths,
  ]);
}

async function removeRuntimeEnvChanges(cwd: string, baseCommit: string) {
  const changedFiles = await git(cwd, [
    "diff",
    "--name-only",
    `${baseCommit}...HEAD`,
  ]);
  const envPaths = splitLines(changedFiles).filter(runtimeEnvPath);
  if (!envPaths.length) return;
  for (const path of envPaths) {
    if (await gitPathExists(cwd, baseCommit, path)) {
      await git(cwd, [
        "restore",
        "--source",
        baseCommit,
        "--staged",
        "--worktree",
        "--",
        path,
      ]);
    } else {
      await git(cwd, ["rm", "--cached", "--ignore-unmatch", "--", path]);
    }
  }
  await git(cwd, ["commit", "-m", "chore: exclude runtime environment files"]);
}

async function changedRuntimeEnvPaths(cwd: string) {
  const paths = await git(cwd, [
    "ls-files",
    "--modified",
    "--deleted",
    "--others",
    "--exclude-standard",
  ]);
  return splitLines(paths).filter(runtimeEnvPath);
}

async function gitPathExists(cwd: string, revision: string, path: string) {
  try {
    await git(cwd, ["cat-file", "-e", `${revision}:${path}`]);
    return true;
  } catch {
    return false;
  }
}

function runtimeEnvPath(path: string) {
  const name = basename(path);
  if (name !== ".env" && !name.startsWith(".env.")) return false;
  return ![".example", ".sample", ".template"].some((suffix) =>
    name.endsWith(suffix),
  );
}

function splitLines(value: string) {
  return value.split("\n").filter(Boolean);
}

export function qualityFromStatus(status: string) {
  return qualityFromStatusDelta("", status);
}

export function qualityFromStatusDelta(baseline: string, status: string) {
  const baselinePaths = new Set(
    statusEntries(baseline).map(({ path }) => path),
  );
  const entries = statusEntries(status).filter(
    ({ path }) => !baselinePaths.has(path),
  );
  return {
    filesModified: new Set(entries.map((entry) => entry.path)).size,
    testsAdded: entries.filter(
      (entry) => entry.added && testFilePath(entry.path),
    ).length,
  };
}

function statusEntries(status: string) {
  return splitLines(status).map(statusEntry);
}

function statusEntry(line: string) {
  const separator = line[2] === " " ? 2 : line[1] === " " ? 1 : 2;
  const status = line.slice(0, separator);
  const path =
    line
      .slice(separator + 1)
      .split(" -> ")
      .at(-1) ?? "";
  return {
    added: status === "??" || status.includes("A"),
    path,
  };
}

function testFilePath(path: string) {
  return /(?:^|\/)(?:__tests__|tests?)\/|\.(?:spec|test)\.[^/]+$/i.test(path);
}

function sessionTaskComplexity(
  input: Pick<SendSessionInput, "prompt" | "userFiles" | "userImages">,
) {
  const attachmentCount =
    (input.userFiles?.length ?? 0) + (input.userImages?.length ?? 0);
  return taskComplexityBucket(input.prompt.length, attachmentCount);
}

function workspaceStatus(cwd: string) {
  return git(cwd, ["status", "--porcelain=v1", "--untracked-files=all"]);
}

function unresolvedMergeConflictMessage(conflicts: string[]) {
  return `Merge conflict agent finished with unresolved conflicts: ${conflicts.join(", ")}`;
}

async function git(cwd: string, args: string[]) {
  try {
    if (customGitRunner) {
      return (await customGitRunner(cwd, args)).trim();
    }
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      env: {
        ...withoutTelemetryEnvironment(process.env),
        GIT_TERMINAL_PROMPT: "0",
        GIT_SSH_COMMAND:
          process.platform === "win32"
            ? "ssh.exe -o BatchMode=yes -o StrictHostKeyChecking=no"
            : "ssh -o BatchMode=yes -o StrictHostKeyChecking=no",
      },
      maxBuffer: 20 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (error) {
    throw new Error(gitErrorMessage(args, error));
  }
}

function gitErrorMessage(args: string[], error: unknown) {
  const record = asRecord(error);
  const output = stringValue(record.stderr) || stringValue(record.stdout);
  const message = output?.trim() || errorMessage(error);
  return `git ${args.join(" ")} failed: ${message}`;
}

function firstTextLine(value: unknown) {
  const line = stringValue(value)
    ?.trim()
    .replace(/^```(?:text)?\s*/, "")
    .replace(/\s*```$/, "")
    .split("\n")
    .find(Boolean)
    ?.trim();
  return line?.replace(/^["'`]|["'`]$/g, "");
}

function truncateText(value: string, limit: number) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n[truncated]`;
}

function approveMergeLogPath(worktree: string) {
  return join(worktree, ".blame", "logs", "approve-merge.log");
}

function commitMessageLogPath(worktree: string) {
  return join(worktree, ".blame", "logs", "commit-message.log");
}

function mergeConflictLogPath(worktree: string) {
  return join(worktree, ".blame", "logs", "merge-conflicts.log");
}

function approveMergeContext(input: ApproveAndMergeInput) {
  return {
    providerId: input.providerId,
    modelId: input.modelId,
    reasoningEffort: input.reasoningEffort,
    repositoryRoot: input.repositoryRoot,
    worktree: input.worktree,
    storyBranch: input.storyBranch,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function forceOAuthRefresh(providerId: string) {
  return providerId === "openai-codex";
}

function supportedClineOAuthProvider(providerId: string) {
  return (
    providerId === "openai-codex" ||
    providerId === "cline" ||
    providerId === "opencode" ||
    providerId === "oca"
  );
}

function openAICodexOAuthProvider(sdk: ClineSdk): OAuthProviderInterface {
  return {
    id: "openai-codex",
    name: "ChatGPT Plus/Pro (ChatGPT Subscription)",
    usesCallbackServer: true,
    login: (callbacks: OAuthLoginCallbacks) => sdk.loginOpenAICodex(callbacks),
    refreshToken: (credentials: ClineOAuthCredentials) =>
      sdk.refreshOpenAICodexToken(credentials.refresh, credentials),
    getApiKey: (credentials: ClineOAuthCredentials) => credentials.access,
  };
}

function clineOAuthProvider(
  sdk: ClineSdk,
  providerId: "cline" | "opencode",
): OAuthProviderInterface {
  const provider = providerId === "opencode" ? providerId : undefined;
  return {
    id: providerId,
    name: providerId === "cline" ? "Cline Account" : "OpenCode",
    usesCallbackServer: false,
    login: (callbacks: OAuthLoginCallbacks) =>
      sdk.loginClineOAuth({
        apiBaseUrl: "https://api.cline.bot",
        callbacks,
        provider,
      }),
    refreshToken: (credentials: ClineOAuthCredentials) =>
      sdk.refreshClineToken(credentials, {
        apiBaseUrl: "https://api.cline.bot",
        provider,
      }),
    getApiKey: clineOAuthApiKey,
  };
}

function ocaOAuthProvider(sdk: ClineSdk): OAuthProviderInterface {
  return {
    id: "oca",
    name: "Oracle Code Assist",
    usesCallbackServer: true,
    login: (callbacks: OAuthLoginCallbacks) => sdk.loginOcaOAuth({ callbacks }),
    refreshToken: (credentials: ClineOAuthCredentials) =>
      sdk.refreshOcaToken(credentials),
    getApiKey: (credentials: ClineOAuthCredentials) => credentials.access,
  };
}

function clineOAuthApiKey(credentials: ClineOAuthCredentials) {
  if (credentials.access.startsWith("workos:")) return credentials.access;
  return `workos:${credentials.access}`;
}

function credentialLabel(input: RuntimeCredentialInput) {
  if (input.credentialLabel) return input.credentialLabel;
  if (input.providerId === openAICompatibleProviderID) return input.modelId;
  return undefined;
}

function startContext(input: StartSessionInput) {
  const contextCompressionMode = effectiveContextCompressionMode(
    input.contextCompressionMode,
  );

  return {
    providerId: input.providerId,
    modelId: input.modelId,
    checkpointEnabled: input.checkpointEnabled,
    configExtensions: input.configExtensions?.join(","),
    contextCompressionMode,
    disableMcpSettingsTools: input.disableMcpSettingsTools,
    mode: input.mode ?? "act",
    maxIterations: input.maxIterations ?? defaultSessionMaxIterations,
    pluginPathCount: input.pluginPaths?.length ?? 0,
    ...promptMetadata(input.prompt),
  };
}

function sessionContext(
  input: StartSessionInput,
  sessionId: string,
): ProductionSessionContext {
  const contextCompressionMode = effectiveContextCompressionMode(
    input.contextCompressionMode,
  );

  return {
    maxIterations: input.maxIterations ?? defaultSessionMaxIterations,
    mode: input.mode ?? "act",
    modelId: input.modelId,
    providerId: input.providerId,
    contextCompressionMode,
    checkpointEnabled: input.checkpointEnabled,
    configExtensions: input.configExtensions?.join(","),
    disableMcpSettingsTools: input.disableMcpSettingsTools,
    pluginPathCount: input.pluginPaths?.length ?? 0,
    sessionId,
  };
}

function developmentMaxIterations() {
  const value = Number(process.env.BLAME_AGENT_DEVELOPMENT_MAX_ITERATIONS);
  return Number.isFinite(value) && value > 0
    ? value
    : defaultDevelopmentMaxIterations;
}

function startLogPath(cwd: string) {
  return join(cwd, ".blame", "logs", "cline-start.log");
}

function sessionLogPath(cwd: string, sessionId: string) {
  return join(cwd, ".blame", "logs", `cline-${sessionId}.log`);
}

export function workspaceSessionIds(
  sessionLogFiles: ReadonlyMap<string, string>,
  workspace: string,
) {
  return Array.from(sessionLogFiles)
    .filter(([, file]) => pathInsideWorkspace(file, workspace))
    .map(([sessionId]) => sessionId);
}

function pathInsideWorkspace(path: string, workspace: string) {
  const relativePath = relative(resolve(workspace), resolve(path));
  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}

function headroomProxyLogPath(cwd: string) {
  return join(cwd, ".blame", "logs", "headroom-proxy.log");
}

function headroomRequestLogPath(cwd: string) {
  return join(cwd, ".blame", "logs", "headroom-requests.jsonl");
}

async function appendLog(
  file: string,
  message: string,
  payload?: unknown,
  activeContext?: import("@blame/telemetry").Context,
) {
  try {
    await mkdir(dirname(file), { recursive: true });
    await appendFile(
      file,
      `${JSON.stringify(logLine(message, safeLogPayload(payload), activeContext))}\n`,
      "utf8",
    );
  } catch {
    console.warn("[blame-agent]", "log write failed");
  }
}

function logLine(
  message: string,
  payload?: unknown,
  activeContext?: import("@blame/telemetry").Context,
) {
  return blameTelemetry.structuredLog(
    logSeverity(payload),
    logEventName(message),
    safeLogPayload(payload),
    activeContext,
  );
}

function logEventName(message: string) {
  return `blame.agent.${message.replace(/[^a-zA-Z0-9_.-]/g, "_")}`;
}

function logSeverity(payload: unknown) {
  const status = stringValue(asRecord(payload).status);
  return status === "failed" || status === "error" ? "error" : "info";
}

export function resultFailureMessage(result: unknown) {
  const payload = asRecord(result);
  const status = resultStatus(payload);
  if (
    !status ||
    !["failed", "error", "cancelled", "aborted", "mistake_limit"].includes(
      status,
    )
  )
    return undefined;
  const error = asRecord(payload.error);
  const message =
    stringValue(error.message) ??
    stringValue(payload.error) ??
    stringValue(payload.message) ??
    firstTextLine(payload.text);
  return message ?? `Agent session ended with status ${status}.`;
}

function resultStatus(payload: Record<string, unknown>) {
  return (
    stringValue(payload.status) ??
    stringValue(payload.state) ??
    stringValue(payload.finishReason) ??
    stringValue(payload.reason)
  );
}

export function initializationToolPolicies() {
  return Object.fromEntries([
    ["submit_project_initialization", { autoApprove: true }],
    ...readTools.map((name) => [
      name,
      initializationFallbackReadTools.has(name)
        ? { autoApprove: true }
        : { enabled: false, autoApprove: false },
    ]),
    ...writeTools.map((name) => [name, { enabled: false, autoApprove: false }]),
  ]);
}

function codePracticesToolPolicies() {
  return Object.fromEntries([
    ["submit_project_code_practices", { autoApprove: true }],
    ...readTools.map((name) => [name, { enabled: false, autoApprove: false }]),
    ...writeTools.map((name) => [name, { enabled: false, autoApprove: false }]),
  ]);
}

function normalizeHookEvent(
  event: Extract<CoreSessionEvent, { type: "hook" }>,
  fallbackSessionId: string,
): AgentEvent {
  const type = event.payload.hookEventName === "agent_error" ? "error" : "tool";
  const payload = asRecord(event.payload);
  return {
    type,
    sessionId: event.payload.sessionId ?? fallbackSessionId,
    payload:
      type === "error"
        ? normalizedErrorPayload(payload, event.payload)
        : event.payload,
  };
}

function normalizeAgentEvent(
  event: Extract<CoreSessionEvent, { type: "agent_event" }>,
  fallbackSessionId: string,
): AgentEvent {
  const payload = asRecord(event.payload.event);
  return normalizeClineAgentPayload(
    payload,
    event.payload.sessionId ?? fallbackSessionId,
    event.payload.event,
  );
}

export function normalizeClineAgentPayload(
  payload: Record<string, unknown>,
  sessionId: string,
  raw: unknown,
): AgentEvent {
  const type = stringValue(payload.type);

  if (type === "error") {
    return {
      type: "error",
      sessionId,
      payload: normalizedErrorPayload(payload, raw),
    };
  }

  if (type === "content_start" || type === "content_update") {
    return normalizeContentEvent(payload, sessionId, raw);
  }

  if (type === "content_end") {
    return normalizeContentEndEvent(payload, sessionId, raw);
  }

  if (type === "done") {
    return {
      type: "done",
      sessionId,
      payload: {
        finishReason: stringValue(payload.finishReason),
        reason:
          stringValue(payload.reason) ??
          stringValue(payload.finishReason) ??
          stringValue(payload.status),
        status: stringValue(payload.status),
        text: stringValue(payload.text),
        usage: doneUsagePayload(payload.usage),
        raw,
      },
    };
  }

  if (type === "usage") {
    return {
      type: "usage",
      sessionId,
      payload: { usage: payload, raw },
    };
  }

  if (type === "iteration_start" || type === "iteration_end") {
    return {
      type: "notice",
      sessionId,
      payload: {
        message:
          type === "iteration_start"
            ? "Agent iteration started."
            : "Agent iteration completed.",
        iteration: numberValue(payload.iteration),
        raw,
      },
    };
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
    };
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
    };
  }

  if (type === "assistant-message") {
    return {
      type: "text",
      sessionId,
      payload: {
        accumulatedText: agentMessageText(asRecord(payload.message)),
        finishReason: stringValue(payload.finishReason),
        iteration: numberValue(payload.iteration),
        raw,
      },
    };
  }

  if (
    type === "tool-started" ||
    type === "tool-updated" ||
    type === "tool-finished"
  ) {
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
    };
  }

  if (type === "usage-updated") {
    return {
      type: "usage",
      sessionId,
      payload: { usage: payload.usage, raw },
    };
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
    };
  }

  if (type === "run-finished") {
    const result = asRecord(payload.result);
    return {
      type: "done",
      sessionId,
      payload: {
        text: stringValue(result.outputText),
        status: stringValue(result.status),
        raw,
      },
    };
  }

  if (type === "run-failed") {
    return {
      type: "error",
      sessionId,
      payload: normalizedErrorPayload(payload, raw),
    };
  }

  const text =
    stringValue(payload.text) ??
    stringValue(payload.content) ??
    stringValue(payload.delta);

  if (text) {
    return {
      type: "text",
      sessionId,
      payload: { text, raw },
    };
  }

  return {
    type: "raw",
    sessionId,
    payload,
  };
}

function normalizedErrorPayload(
  payload: Record<string, unknown>,
  raw: unknown,
) {
  const error = asRecord(payload.error);
  return {
    iteration: numberValue(payload.iteration),
    message:
      stringValue(error.message) ??
      stringValue(payload.message) ??
      stringValue(payload.error) ??
      "Agent session failed.",
    recoverable: booleanValue(payload.recoverable),
    raw,
  };
}

function eventLogPayload(event: AgentEvent) {
  const payload = asRecord(event.payload);
  if (event.type === "usage")
    return summarizeUsage({ aggregateUsage: asRecord(payload.usage) as never });
  if (event.type === "tool") return toolLogPayload(payload);
  if (event.type === "done") return doneLogPayload(payload);
  if (event.type === "error") return errorLogPayload(payload);
  return {
    sessionId: event.sessionId,
    status: event.type,
  };
}

export function duplicateEventSignature(event: AgentEvent) {
  if (event.type === "raw") return undefined;
  if (event.type === "text" || event.type === "reasoning") return undefined;
  const payload = asRecord(event.payload);
  const text = eventText(payload);
  const tool = toolNameFromPayload(payload);
  if (tool === "spawn_agent") return undefined;
  const value =
    text || tool || stringValue(payload.reason) || stringValue(payload.status);
  if (!value) return undefined;
  return [event.type, event.sessionId, value].join(":");
}

function removeOldEventSignatures(
  signatures: Map<string, number>,
  now: number,
) {
  for (const [signature, timestamp] of signatures.entries()) {
    if (now - timestamp > 1_000) signatures.delete(signature);
  }
}

function eventText(payload: Record<string, unknown>) {
  return (
    stringValue(payload.text) ??
    stringValue(payload.message) ??
    stringValue(payload.accumulatedText)
  );
}

function toolNameFromPayload(payload: Record<string, unknown>) {
  const toolCall = asRecord(payload.toolCall);
  return (
    stringValue(toolCall.name) ??
    stringValue(toolCall.toolName) ??
    stringValue(payload.toolName)
  );
}

function eventUsageSummary(event: AgentEvent): AgentUsageSummary | undefined {
  if (event.type !== "usage" && event.type !== "done") return undefined;
  const payload = asRecord(event.payload);
  const usage = asRecord(payload.usage);
  if (!Object.keys(usage).length) return undefined;
  return { aggregateUsage: usage as never };
}

function nextHeadroomSavings(
  current: HeadroomSavingsTotals | undefined,
  usage: HeadroomCompressionUsage,
): HeadroomSavingsTotals {
  return {
    compressionCount: (current?.compressionCount ?? 0) + 1,
    lastTokensSaved: usage.tokensSaved,
    tokensAfter: (current?.tokensAfter ?? 0) + usage.tokensAfter,
    tokensBefore: (current?.tokensBefore ?? 0) + usage.tokensBefore,
    tokensSaved: (current?.tokensSaved ?? 0) + usage.tokensSaved,
  };
}

function headroomUsagePayload(totals: HeadroomSavingsTotals) {
  return {
    headroomCompressionCount: totals.compressionCount,
    headroomCompressionRatio: headroomCompressionRatio(totals),
    headroomLastTokensSaved: totals.lastTokensSaved,
    headroomTokensAfter: totals.tokensAfter,
    headroomTokensBefore: totals.tokensBefore,
    headroomTokensSaved: totals.tokensSaved,
  };
}

function headroomCompressionRatio(totals: HeadroomSavingsTotals) {
  if (!totals.tokensBefore) return undefined;
  return totals.tokensAfter / totals.tokensBefore;
}

function doneUsagePayload(value: unknown) {
  const usage = asRecord(value);
  if (!Object.keys(usage).length || usageHasTotals(usage)) return value;
  return {
    totalCacheReadTokens: usage.cacheReadTokens,
    totalCacheWriteTokens: usage.cacheWriteTokens,
    totalCost: usage.totalCost,
    totalInputTokens: usage.inputTokens,
    totalOutputTokens: usage.outputTokens,
  };
}

function usageHasTotals(usage: Record<string, unknown>) {
  return (
    usage.totalInputTokens !== undefined ||
    usage.totalOutputTokens !== undefined ||
    usage.totalCacheReadTokens !== undefined ||
    usage.totalCacheWriteTokens !== undefined
  );
}

function normalizeAgentUsageSummary(
  summary: SessionUsageSummary | undefined,
): AgentUsageSummary | undefined {
  if (!summary) return undefined;
  return {
    usage: normalizeAgentUsageTotals(summary.usage),
    aggregateUsage: normalizeAgentUsageTotals(summary.aggregateUsage),
  };
}

function normalizeAgentUsageTotals(
  usage: SessionUsageSummary["usage"] | undefined,
) {
  if (!usage) return undefined;
  const totalUsage = usage as SessionUsageSummary["usage"] & {
    totalCacheReadTokens?: number;
    totalCacheWriteTokens?: number;
    totalInputTokens?: number;
    totalOutputTokens?: number;
  };
  return {
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalCacheReadTokens:
      totalUsage.totalCacheReadTokens ?? usage.cacheReadTokens,
    totalCacheWriteTokens:
      totalUsage.totalCacheWriteTokens ?? usage.cacheWriteTokens,
    totalCost: usage.totalCost,
    totalInputTokens: totalUsage.totalInputTokens ?? usage.inputTokens,
    totalOutputTokens: totalUsage.totalOutputTokens ?? usage.outputTokens,
  };
}

function toolLogPayload(payload: Record<string, unknown>) {
  return {
    durationMs: numberValue(payload.durationMs),
    status: stringValue(payload.phase),
    success: stringValue(payload.phase) !== "failed",
    toolName: toolNameFromPayload(payload),
  };
}

function doneLogPayload(payload: Record<string, unknown>) {
  return {
    finishReason:
      stringValue(payload.reason) ?? stringValue(payload.finishReason),
    status: stringValue(payload.status) ?? "done",
    ...summarizeUsage({ aggregateUsage: asRecord(payload.usage) as never }),
  };
}

function errorLogPayload(payload: Record<string, unknown>) {
  const error = asRecord(payload.error);
  return {
    errorType: stringValue(error.name) ?? "Error",
    message: stringValue(payload.message) ?? stringValue(error.message),
    status: "failed",
  };
}

function sendResultLogPayload(result: unknown, durationMs: number) {
  const payload = asRecord(result);
  return {
    durationMs,
    finishReason:
      stringValue(payload.finishReason) ?? stringValue(payload.reason),
    status: resultStatus(payload) ?? "completed",
    ...summarizeUsage({ aggregateUsage: asRecord(payload.usage) as never }),
  };
}

function doneResultPayload(result: unknown) {
  const payload = asRecord(result);
  const status = resultStatus(payload);
  const finishReason = stringValue(payload.finishReason);
  return {
    finishReason,
    iterations: numberValue(payload.iterations),
    reason: stringValue(payload.reason) ?? finishReason ?? status,
    status,
    text: stringValue(payload.text) ?? stringValue(payload.outputText),
    usage: payload.usage,
  };
}

function normalizeContentEvent(
  payload: Record<string, unknown>,
  sessionId: string,
  raw: unknown,
): AgentEvent {
  const contentType = stringValue(payload.contentType);
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
    };
  }
  if (contentType === "reasoning" || contentType === "thinking") {
    return {
      type: "reasoning",
      sessionId,
      payload: {
        text: stringValue(payload.reasoning) ?? stringValue(payload.text) ?? "",
        phase: "started",
        redacted: booleanValue(payload.redacted),
        raw,
      },
    };
  }
  return {
    type: "text",
    sessionId,
    payload: {
      text: stringValue(payload.text) ?? "",
      phase: "started",
      raw,
    },
  };
}

function normalizeContentEndEvent(
  payload: Record<string, unknown>,
  sessionId: string,
  raw: unknown,
): AgentEvent {
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
    };
  }
  if (
    stringValue(payload.contentType) === "reasoning" ||
    stringValue(payload.contentType) === "thinking"
  ) {
    return {
      type: "reasoning",
      sessionId,
      payload: { phase: "finished", raw },
    };
  }
  return {
    type: "text",
    sessionId,
    payload: { phase: "finished", raw },
  };
}

function agentMessageText(message: Record<string, unknown>) {
  const content = message.content;
  if (!Array.isArray(content)) return "";
  return content.map(agentMessagePartText).join("");
}

function agentMessagePartText(value: unknown) {
  const part = asRecord(value);
  if (stringValue(part.type) !== "text") return "";
  return stringValue(part.text) ?? "";
}

function toApprovalRequest(
  request: ToolApprovalRequest,
  toolName: string,
): AgentApprovalRequest {
  return {
    id: randomUUID(),
    sessionId: request.sessionId,
    toolName,
    reason: request.reason,
    input: request.input,
  };
}

function blockedToolReason(toolName: string, input: unknown) {
  if (toolName !== "run_commands") return undefined;
  const command = stringValue(asRecord(input).command);
  if (!command) return undefined;
  return blockedCommandParts.some((part) => command.includes(part))
    ? "Command blocked by security policy"
    : undefined;
}

function asRecord(value: unknown) {
  if (value && typeof value === "object")
    return value as Record<string, unknown>;
  return {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

function boundedNumber(value: unknown, min: number, max: number) {
  const number = numberValue(value);
  if (number === undefined || !Number.isFinite(number)) return undefined;
  return Math.min(Math.max(number, min), max);
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function parseChunkEvent(value: string) {
  try {
    const parsed = JSON.parse(value);
    return asRecord(parsed);
  } catch {
    return undefined;
  }
}

function toBlameOAuthCredentials(
  credentials: ClineOAuthCredentials,
): OAuthCredentials {
  return {
    access: credentials.access,
    refresh: credentials.refresh,
    expires: credentials.expires,
    accountId: credentials.accountId,
    email: credentials.email,
    metadata: credentials.metadata,
  };
}

function errorType(error: unknown) {
  return error instanceof Error ? error.constructor.name : "Error";
}
