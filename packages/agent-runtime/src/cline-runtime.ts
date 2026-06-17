import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { access, appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

import type {
  ClineCore,
  ClineCoreOptions,
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
import { loadPrompt } from "./prompt-loader.js";
import {
  appendProductionConfig,
  assertRepositoryPath,
  assertWorkspacePath,
  blameCompactionConfig,
  createProductionLogger,
  createProductionTelemetry,
  loadProductionConfig,
  promptMetadata,
  recordUsageTelemetry,
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
  AgentEvent,
  AgentRuntimeEvents,
  AgentUsageSummary,
  ApiConnection,
  ApproveAndMergeInput,
  ApproveAndMergeResult,
  AssessProjectInitializationImpactInput,
  AssessProjectInitializationImpactResult,
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
];
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
const openAICompatibleProviderID = "openai-compatible";
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

type PendingApproval = {
  request: AgentApprovalRequest;
  resolve(result: ToolApprovalResult): void;
};

type RuntimeSessionSummary = {
  sessionId?: string;
};

type InitializationCorrection = {
  previousResult: string;
  validationError: string;
};

type ProjectInitializationSubmitTool = {
  tool: AgentTool;
  input?: unknown;
};

type PreviewDevtoolsTarget = {
  available: boolean;
  browserUrl: string;
  currentUrl?: string;
  id?: string;
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
>;

type RuntimeOptions = {
  openExternalUrl?(url: string): void;
  git?(cwd: string, args: string[]): Promise<string>;
  previewDevtools?(): PreviewDevtoolsTarget | undefined;
};

let customGitRunner: ((cwd: string, args: string[]) => Promise<string>) | undefined;

export class BlameAgentRuntime {
  private clines = new Map<string, Promise<ClineCore>>();
  private sessionBackendKeys = new Map<string, string>();
  private telemetryHandle?: Promise<
    Awaited<ReturnType<typeof createProductionTelemetry>>
  >;
  private unsubscribers = new Map<string, () => void>();
  private pendingApprovals = new Map<string, PendingApproval>();
  private alwaysAllowedTools = new Set<string>();
  private autoApprovedWriteToolSessions = new Set<string>();
  private sessionLogFiles = new Map<string, string>();
  private sessionContexts = new Map<string, ProductionSessionContext>();
  private sessionEventSignatures = new Map<string, Map<string, number>>();
  private sessionIterations = new Map<string, number>();
  private sessionUsageSignatures = new Map<string, string>();
  private readonly productionConfig = loadProductionConfig();
  private readonly events?: AgentRuntimeEvents;
  private readonly options: RuntimeOptions;

  constructor(events?: AgentRuntimeEvents, options: RuntimeOptions = {}) {
    this.events = events;
    this.options = options;
    if (options.git) {
      customGitRunner = options.git;
    }
    void import("@cline/sdk").catch(() => undefined);
    void this.telemetry().catch(() => undefined);
  }

  providers = {
    list: (connection: ApiConnection) => listProviders(connection),
    saveCredential: (
      connection: ApiConnection,
      input: SaveProviderCredentialInput,
    ) => saveProviderCredential(connection, input),
    deleteCredential: (connection: ApiConnection, id: number) =>
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
    list: () => this.listSessions(),
    messages: (sessionId: string) => this.readMessages(sessionId),
    usage: (sessionId: string) => this.readUsage(sessionId),
    unsubscribe: (sessionId: string) => this.unsubscribeSession(sessionId),
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

  newProjects = {
    generate: (input: StartNewProjectGenerationInput) =>
      this.generateNewProject(input),
  };

  promptOptimizer = {
    optimizeUserStory: (input: OptimizeUserStoryPromptInput) =>
      this.optimizeUserStoryPrompt(input),
  };

  approveAndMerge = (input: ApproveAndMergeInput) =>
    this.approveAndMergeStory(input);

  async shutdown() {
    const sessionIds = await this.activeSessionIds();
    await Promise.allSettled(
      sessionIds.map((sessionId) => this.abortSession(sessionId)),
    );
    sessionIds.forEach((sessionId) => this.unsubscribeSession(sessionId));
    this.resolvePendingApprovals();
    this.sessionLogFiles.clear();
    this.sessionContexts.clear();
    this.sessionEventSignatures.clear();
    await this.disposeCore();
    await this.disposeTelemetry();
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
    const [module, telemetry] = await Promise.all([
      import("@cline/sdk"),
      this.telemetry(),
    ]);
    return module.ClineCore.create({
      ...coreBackendOptions(backend),
      clientName: "blame",
      toolPolicies: toolPolicies(false),
      capabilities: {
        requestToolApproval: (request: ToolApprovalRequest) =>
          this.requestApproval(request),
      },
      logger: productionLogger,
      telemetry: telemetry?.telemetry,
    });
  }

  private async sessionCore(sessionId: string) {
    const key = this.sessionBackendKeys.get(sessionId);
    const current = key ? this.clines.get(key) : undefined;
    return current ?? this.core();
  }

  private telemetry() {
    if (!this.telemetryHandle) {
      this.telemetryHandle = createProductionTelemetry(productionLogger);
    }
    return this.telemetryHandle;
  }

  private async startSession(input: StartSessionInput) {
    assertWorkspacePath(input.cwd, input.workspaceRoot, "cwd");
    const startLogFile = startLogPath(input.cwd);
    await appendLog(startLogFile, "start requested", startContext(input));
    const startedAt = Date.now();
    try {
      const credential = await resolveProviderCredential(input.apiConnection, {
        providerId: input.providerId,
        label: credentialLabel(input),
      });
      await appendLog(startLogFile, "credential resolved", {
        providerId: credential.providerId,
        authMethod: credential.authMethod,
        hasBaseUrl: !!credential.baseUrl,
      });
      const resolvedCredential = await this.refreshOAuthCredential(
        input.apiConnection,
        credential,
        {
          force: forceOAuthRefresh(credential.providerId),
        },
      );
      await appendLog(startLogFile, "credential refreshed", {
        providerId: resolvedCredential.providerId,
        authMethod: resolvedCredential.authMethod,
        hasBaseUrl: !!resolvedCredential.baseUrl,
        expires: resolvedCredential.oauthCredentials?.expires,
      });
      await this.syncClineOAuthProviderSettings(resolvedCredential);
      if (resolvedCredential.authMethod === "oauth") {
        await appendLog(startLogFile, "cline oauth settings synced", {
          providerId: resolvedCredential.providerId,
          accountId: resolvedCredential.oauthCredentials?.accountId,
          email: resolvedCredential.oauthCredentials?.email,
          expires: resolvedCredential.oauthCredentials?.expires,
        });
      }
      const cline = await this.core(input.backend);
      await appendLog(startLogFile, "cline core ready");
      const sessionId = createBlameSessionId();
      const sessionLogFile = sessionLogPath(input.cwd, sessionId);
      await this.subscribeSession(sessionId, input.backend);
      this.sessionBackendKeys.set(sessionId, backendKey(input.backend));
      this.sessionLogFiles.set(sessionId, sessionLogFile);
      this.sessionContexts.set(sessionId, sessionContext(input, sessionId));
      if (input.autoApproveWriteTools) {
        this.autoApprovedWriteToolSessions.add(sessionId);
      }
      const autoSendPrompt = input.autoSendPrompt !== false;
      const startInput = {
        ...(autoSendPrompt ? { prompt: input.prompt } : {}),
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
            thinking: !!input.reasoningEffort,
            reasoningEffort: input.reasoningEffort,
            systemPrompt:
              input.systemPrompt ?? loadPrompt("default-agent-system"),
            cwd: input.cwd,
            workspaceRoot: input.workspaceRoot,
            mode: input.mode ?? "act",
            maxIterations: input.maxIterations ?? defaultSessionMaxIterations,
            compaction: blameCompactionConfig(this.productionConfig),
            enableTools: true,
            enableSpawnAgent: false,
            enableAgentTeams: false,
            extensionContext: extensionContext(input),
            extraTools: runtimeTools(this.options),
          }),
        },
        interactive: !autoSendPrompt,
        source: "blame-desktop",
        toolPolicies: toolPolicies(!!input.autoApproveWriteTools),
      } as const;
      if (autoSendPrompt) {
        void cline
          .start(startInput)
          .then((session: { sessionId: string }) =>
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
      const session = await cline.start(startInput);
      this.sessionBackendKeys.set(session.sessionId, backendKey(input.backend));
      await appendLog(startLogFile, "session created", {
        durationMs: Date.now() - startedAt,
        sessionId: session.sessionId,
        logFile: sessionLogFile,
      });
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
      return session;
    } catch (error) {
      await appendLog(startLogFile, "start failed", {
        durationMs: Date.now() - startedAt,
        errorType: errorType(error),
        message: errorMessage(error),
        status: "failed",
      });
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
    await appendLog(startLogFile, "session created", {
      durationMs: Date.now() - startedAt,
      sessionId,
      logFile: sessionLogFile,
    });
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
    const message = errorMessage(error);
    await appendLog(startLogFile, "start failed", {
      durationMs: Date.now() - startedAt,
      errorType: errorType(error),
      message,
      status: "failed",
    });
    this.emitSessionError(sessionId, message);
  }

  private async sendSession(input: SendSessionInput) {
    const cline = await this.sessionCore(input.sessionId);
    return this.sendPrompt(cline, input.sessionId, input.prompt, {
      userFiles: input.userFiles,
      userImages: input.userImages,
    });
  }

  private async sendDevelopmentSession(input: SendDevelopmentSessionInput) {
    const developmentInput = await developmentUserInput(
      input,
      this.attachmentDirectory(input.sessionId),
    );
    return this.sendSession({
      sessionId: input.sessionId,
      ...developmentInput,
    });
  }

  private async abortSession(sessionId: string) {
    const cline = await this.sessionCore(sessionId);
    await cline.abort(sessionId, "User aborted from Blame");
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

  private async readUsage(
    sessionId: string,
  ): Promise<AgentUsageSummary | undefined> {
    const cline = await this.sessionCore(sessionId);
    return normalizeAgentUsageSummary(await cline.getAccumulatedUsage(sessionId));
  }

  private async initializeProject(
    input: InitializeProjectInput,
  ): Promise<InitializeProjectResult> {
    assertWorkspacePath(input.cwd, input.workspaceRoot, "cwd");
    const resolvedCredential = await this.initializationCredential(input);
    const scan = await scanProjectForInitialization(input.workspaceRoot);
    const cline = await this.core(input.backend);
    let correction = input.validationFeedback;
    for (let attempt = 1; attempt <= maxInitializationAttempts; attempt += 1) {
      const submitTool = projectInitializationSubmitTool();
      const session = await cline.start({
        prompt: initializationPrompt(scan, correction),
        config: initializationConfig(input, resolvedCredential, submitTool.tool),
        interactive: false,
        source: "blame-project-initialization",
        toolPolicies: initializationToolPolicies(),
      });
      const submittedInput =
        submitTool.input ??
        projectInitializationInputFromResult(session.result) ??
        (await projectInitializationInputFromMessages(
          cline,
          session.sessionId,
        ));
      const result = submittedInput ?? session.result?.text;
      if (!result)
        throw new Error("Project initialization agent did not return a result");
      try {
        return {
          sessionId: session.sessionId,
          ...(submittedInput
            ? parseProjectInitializationPayload(
                submittedInput,
                scan,
                input.preferences,
              )
            : parseProjectInitializationResult(
                String(result),
                scan,
                input.preferences,
              )),
        };
      } catch (error) {
        if (attempt === maxInitializationAttempts) throw error;
        correction = {
          previousResult:
            typeof result === "string" ? result : JSON.stringify(result),
          validationError: errorMessage(error),
        };
      }
    }
    throw new Error(
      "Project initialization agent did not return a valid result",
    );
  }

  private async repairProjectInitialization(
    input: RepairProjectInitializationInput,
  ): Promise<RepairProjectInitializationResult> {
    assertWorkspacePath(input.cwd, input.workspaceRoot, "cwd");
    const credential = await this.runtimeCredential(input);
    const scan = await scanProjectForInitialization(input.workspaceRoot);
    const cline = await this.core(input.backend);
    let correction: InitializationCorrection | undefined;
    for (let attempt = 1; attempt <= maxInitializationAttempts; attempt += 1) {
      const session = await this.startProjectInitializationRepairAttempt(
        cline,
        input,
        scan,
        credential,
        correction,
      );
      const text = session.result?.text;
      if (!text)
        throw new Error(
          "Project initialization repair agent did not return a result",
        );
      try {
        return {
          sessionId: session.sessionId,
          ...parseProjectInitializationRepairResult(text, scan),
        };
      } catch (error) {
        if (attempt === maxInitializationAttempts) throw error;
        correction = {
          previousResult: text,
          validationError: errorMessage(error),
        };
      }
    }
    throw new Error(
      "Project initialization repair agent did not return a valid result",
    );
  }

  private startProjectInitializationRepairAttempt(
    cline: ClineCore,
    input: RepairProjectInitializationInput,
    scan: ProjectInitializationScan,
    credential: { apiKey: string; baseUrl: string | null },
    correction?: InitializationCorrection,
  ) {
    return cline.start({
      prompt: projectInitializationRepairPrompt(input, scan, correction),
      config: initializationRepairConfig(input, credential),
      interactive: false,
      source: "blame-project-initialization-repair",
      toolPolicies: initializationToolPolicies(),
    });
  }

  private async assessProjectInitializationImpact(
    input: AssessProjectInitializationImpactInput,
  ): Promise<AssessProjectInitializationImpactResult> {
    assertWorkspacePath(input.cwd, input.workspaceRoot, "cwd");
    const diagnostics =
      await collectProjectInitializationImpactDiagnostics(input);
    const deterministic = deterministicInitializationImpact(diagnostics);
    if (deterministic) return { ...deterministic, diagnostics };
    const credential = await this.runtimeCredential(input);
    const cline = await this.core(input.backend);
    const session = await cline.start({
      prompt: projectInitializationImpactPrompt(diagnostics),
      config: initializationImpactConfig(input, credential),
      interactive: false,
      source: "blame-project-initialization-impact",
      toolPolicies: initializationToolPolicies(),
    });
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

  private async generateNewProject(
    input: StartNewProjectGenerationInput,
  ): Promise<NewProjectGenerationResult> {
    assertWorkspacePath(input.cwd, input.workspaceRoot, "cwd");
    const credential = await this.runtimeCredential(input);
    const cline = await this.core(input.backend);
    const sessionId = input.sessionId ?? createBlameSessionId();
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
      const session = await cline.start({
        prompt: newProjectGenerationPrompt(input),
        config: await newProjectGenerationConfig(
          input,
          credential,
          sessionId,
          this.productionConfig,
        ),
        interactive: false,
        source: "blame-new-project-generation",
        toolPolicies: toolPolicies(true),
      });
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
      this.unsubscribeSession(sessionId);
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
    return optimizeUserStoryPrompt({ ...input, prompt }, cline, credential);
  }

  private async initializationCredential(input: InitializeProjectInput) {
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
    assertRepositoryPath(input.repositoryRoot, "repositoryRoot");
    assertRepositoryPath(input.worktree, "worktree");
    const logFile = approveMergeLogPath(input.worktree);
    await appendLog(
      logFile,
      "approve merge requested",
      approveMergeContext(input),
    );
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
    await this.commitStoryWork(input);
    await this.mergeTargetIntoStory(input, targetBranch, upstream);
    await removeRuntimeEnvChanges(input.worktree, baseCommit);
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
    const message = await this.generateCommitMessage(
      input,
      approveMergeLogPath(input.worktree),
    );
    await addStoryChanges(input.worktree);
    await git(input.worktree, ["commit", "-m", message]);
    const nextStatus = await storyStatus(input.worktree, "--porcelain");
    if (nextStatus.trim())
      throw new Error(
        "Story worktree still has uncommitted changes after commit.",
      );
  }

  private async generateCommitMessage(
    input: ApproveAndMergeInput,
    logFile: string,
  ) {
    if (!commitMessageConventionEnabled(input)) {
      const message = await fallbackCommitMessage(input);
      await appendLog(logFile, "commit message fallback selected", {
        reason: "commit_message_convention_disabled",
        status: "fallback",
        success: true,
      });
      return message;
    }
    try {
      const startedAt = Date.now();
      const credential = await this.runtimeCredential(input);
      const cline = await this.core(input.backend);
      const session = await cline.start({
        prompt: await commitMessagePrompt(input),
        config: commitMessageConfig(input, credential),
        interactive: false,
        source: "blame-approve-merge",
        toolPolicies: initializationToolPolicies(),
      });
      const message = commitMessageFromAgentResult(session.result);
      const validMessage = standardCommitMessageAllowed(input, message)
        ? message
        : undefined;
      await appendLog(logFile, "commit message agent finished", {
        durationMs: Date.now() - startedAt,
        sessionId: session.sessionId,
        status: resultStatus(asRecord(session.result)),
        success: Boolean(validMessage),
      });
      if (validMessage) return validMessage;
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
    await this.resolveMergeConflicts(
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

  private async resolveMergeConflicts(
    input: ApproveAndMergeInput,
    targetBranch: string,
    logFile: string,
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
    if (conflicts.length)
      throw new Error(unresolvedMergeConflictMessage(conflicts));
  }

  private async runMergeConflictAgent(
    input: ApproveAndMergeInput,
    targetBranch: string,
    attempt: number,
    logFile: string,
  ) {
    const startedAt = Date.now();
    const credential = await this.runtimeCredential(input);
    const cline = await this.core(input.backend);
    const session = await cline.start({
      prompt: await mergeConflictPrompt(input, targetBranch, attempt),
      config: mergeConflictConfig(input, credential),
      interactive: false,
      source: "blame-merge-conflict-resolution",
      toolPolicies: toolPolicies(true),
    });
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
    this.unsubscribeSession(sessionId);
    const cline = await this.core(backend);
    const unsubscribe = await cline.subscribe(
      (payload: CoreSessionEvent) => {
        const event = this.withSessionIteration(
          sessionId,
          normalizeEvent(sessionId, payload),
        );
        if (this.shouldSkipDuplicateSessionEvent(sessionId, event)) return;
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
    if (event.type !== "tool" || eventIteration !== undefined) return event;
    const iteration = this.sessionIterations.get(sessionId);
    if (iteration === undefined) return event;
    return { ...event, payload: { ...payload, iteration } };
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
    await this.logSession(
      sessionId,
      `event:${event.type}`,
      eventLogPayload(event),
    );
    const eventUsage = eventUsageSummary(event);
    if (!eventUsage) return;
    const usage = eventUsage ?? (await this.readUsage(sessionId));
    const usageSignature = JSON.stringify(summarizeUsage(usage));
    if (this.sessionUsageSignatures.get(sessionId) === usageSignature) return;
    this.sessionUsageSignatures.set(sessionId, usageSignature);
    const context = this.sessionContexts.get(sessionId) ?? { sessionId };
    await this.logSession(sessionId, "usage updated", {
      ...context,
      ...summarizeUsage(usage),
    });
    recordUsageTelemetry((await this.telemetry())?.telemetry, usage, context);
    if (!shouldAbortForUsage(usage, this.productionConfig)) return;
    const message = usageLimitMessage(usage, this.productionConfig);
    this.emitSessionError(sessionId, message);
    await this.abortSession(sessionId);
  }

  private unsubscribeSession(sessionId: string) {
    this.unsubscribers.get(sessionId)?.();
    this.unsubscribers.delete(sessionId);
    this.autoApprovedWriteToolSessions.delete(sessionId);
    this.sessionContexts.delete(sessionId);
    this.sessionEventSignatures.delete(sessionId);
    this.sessionIterations.delete(sessionId);
    this.sessionUsageSignatures.delete(sessionId);
    this.sessionBackendKeys.delete(sessionId);
    void this.logSession(sessionId, "session unsubscribed");
  }

  private async activeSessionIds() {
    const sessionIds = new Set(this.unsubscribers.keys());
    await Promise.all(
      Array.from(this.clines.values()).map(async (core) => {
        try {
          const sessions = (await (await core).list(50)) as RuntimeSessionSummary[];
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

  private async logSession(
    sessionId: string,
    message: string,
    payload?: unknown,
  ) {
    const file = this.sessionLogFiles.get(sessionId);
    if (!file) return;
    await appendLog(file, message, payload);
  }

  private async disposeCore() {
    const clines = Array.from(this.clines.values());
    this.clines.clear();
    this.sessionBackendKeys.clear();
    await Promise.allSettled(
      clines.map(async (cline) => (await cline).dispose("Shutting down")),
    );
  }

  private async disposeTelemetry() {
    const telemetry = await this.telemetryHandle;
    await telemetry?.flush();
    await telemetry?.dispose();
    this.telemetryHandle = undefined;
  }

  private async startDevelopmentSession(input: StartDevelopmentSessionInput) {
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
      autoApproveWriteTools: true,
      autoSendPrompt: input.autoSendPrompt !== false,
      mode: "act",
      maxIterations: input.maxIterations ?? developmentMaxIterations(),
      prompt: developmentInput.prompt,
      userFiles: developmentInput.userFiles,
      userImages: developmentInput.userImages,
      cwd: input.cwd,
      workspaceRoot: input.workspaceRoot,
      systemPrompt: await developmentSystemPrompt(input),
      backend: input.backend,
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
    const result = cline
      .send({
        sessionId,
        prompt,
        ...(attachments.userImages?.length
          ? { userImages: attachments.userImages }
          : {}),
        ...(attachments.userFiles?.length
          ? { userFiles: attachments.userFiles }
          : {}),
      })
      .then((result: unknown) => {
        void this.logSession(
          sessionId,
          "send resolved",
          sendResultLogPayload(result, Date.now() - startedAt),
        );
        const failure = resultFailureMessage(result);
        if (failure) {
          this.emitSessionError(sessionId, failure);
          return result;
        }
        this.events?.emit({ type: "done", sessionId, payload: result });
        return result;
      })
      .catch((error: unknown) => {
        const message = errorMessage(error);
        void this.logSession(sessionId, "send failed", {
          durationMs: Date.now() - startedAt,
          errorType: errorType(error),
          message,
          status: "failed",
        });
        this.emitSessionError(sessionId, message);
        throw error;
      });
    void this.logSession(sessionId, "prompt sent", {
      ...promptMetadata(prompt),
    });
    return result;
  }
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

function toolPolicies(autoApproveWriteTools: boolean) {
  return Object.fromEntries([
    ...readTools.map((name) => [name, { autoApprove: true }]),
    ...writeTools.map((name) => [name, { autoApprove: autoApproveWriteTools }]),
  ]);
}

function backendKey(backend?: AgentBackendConfig) {
  if (backend?.key) return backend.key;
  if (!backend) return "auto";
  if (backend.mode === "remote") return `remote:${backend.endpoint ?? ""}`;
  if (backend.mode === "hub") return `hub:${backend.endpoint ?? "default"}`;
  return backend.mode;
}

function coreBackendOptions(backend?: AgentBackendConfig): ClineCoreOptions {
  if (!backend) return { backendMode: "auto" };
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

function projectInitializationSubmitTool(): ProjectInitializationSubmitTool {
  const submit: ProjectInitializationSubmitTool = {
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

function runtimeTools(options: RuntimeOptions) {
  const tools = [previewDevtoolsTool(options)].filter(
    (tool): tool is AgentTool => Boolean(tool),
  );
  return tools.length ? tools : undefined;
}

function previewDevtoolsTool(options: RuntimeOptions): AgentTool | undefined {
  if (!options.previewDevtools) return undefined;
  return {
    name: "get_preview_devtools",
    description:
      "Get the active Blame preview Chrome DevTools MCP server configuration and current preview URL.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    execute() {
      const target = options.previewDevtools?.();
      if (!target?.available) {
        return {
          available: false,
          reason: "No active Blame preview is currently loaded.",
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
  input: ApproveAndMergeInput,
  credential: { apiKey: string; baseUrl: string | null },
) {
  return appendProductionConfig({
    providerId: input.providerId,
    modelId: input.modelId,
    apiKey: credential.apiKey,
    baseUrl: credential.baseUrl ?? undefined,
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
  input: ApproveAndMergeInput,
  credential: { apiKey: string; baseUrl: string | null },
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

async function developmentUserInput(
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
  return {
    prompt: developmentStoryPrompt(input, attachments),
    userFiles: attachments.userFiles,
    userImages: attachments.userImages,
  };
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
  );
  return prompt.join("\n");
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
  return `- ${attachment.name} (${attachment.type || "application/octet-stream"}, ${attachment.size} bytes)`;
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

async function developmentSystemPrompt(input: StartDevelopmentSessionInput) {
  const metadata = await buildWorkspaceMetadata(input.cwd);
  const practices = input.codePractices ?? [];
  const rules = [
    loadPrompt("code-agent-system"),
    developmentPracticePrompt(practices, "coding_style"),
    developmentPracticePrompt(practices, "layered_architecture"),
    developmentPracticePrompt(practices, "unit_tests"),
  ].join("\n\n");
  return getClineDefaultSystemPrompt({
    ide: "Blame",
    metadata,
    mode: "act",
    platform: process.platform,
    providerId: input.providerId,
    rules: mergeRulesForSystemPrompt(undefined, rules),
    workspaceName: basename(input.workspaceRoot),
    workspaceRoot: input.workspaceRoot,
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

async function commitMessagePrompt(input: ApproveAndMergeInput) {
  const [status, changedFiles, diffStat, log] = await Promise.all([
    storyStatus(input.worktree, "--porcelain"),
    storyChangedFiles(input.worktree),
    storyDiffStat(input.worktree),
    git(input.worktree, ["log", "-12", "--pretty=%s"]),
  ]);
  return [
    `Backlog item: ${input.title}`,
    "",
    input.summary,
    "",
    `Git status:\n${truncateText(status, 8_000)}`,
    "",
    `Changed files:\n${truncateText(changedFiles, 12_000)}`,
    "",
    `Diff stat:\n${truncateText(diffStat, 12_000)}`,
    "",
    `Recent commits:\n${truncateText(log, 8_000)}`,
  ].join("\n");
}

async function storyChangedFiles(cwd: string) {
  return git(cwd, [
    "diff",
    "--no-ext-diff",
    "--name-status",
    "HEAD",
    "--",
    ".",
    ...runtimeArtifactPathspecs,
  ]);
}

async function storyDiffStat(cwd: string) {
  return git(cwd, [
    "diff",
    "--no-ext-diff",
    "--stat",
    "HEAD",
    "--",
    ".",
    ...runtimeArtifactPathspecs,
  ]);
}

async function fallbackCommitMessage(input: ApproveAndMergeInput) {
  const [status, log] = await Promise.all([
    storyStatus(input.worktree, "--porcelain"),
    git(input.worktree, ["log", "-12", "--pretty=%s"]),
  ]);
  const files = statusFileNames(status);
  const standardConvention = commitMessageConventionEnabled(input);
  const subject = standardConvention
    ? fallbackEnglishCommitSubject(files)
    : fallbackCommitSubject(input.title);
  const bracketPrefix = dominantBracketPrefix(log);
  if (!standardConvention && bracketPrefix) {
    return limitCommitMessage(`${bracketPrefix} ${subject}`);
  }
  const scope = commitScope(files);
  const type = commitType(files);
  return limitCommitMessage(`${type}${scope ? `(${scope})` : ""}: ${subject}`);
}

function commitMessageFromAgentResult(result: unknown) {
  const payload = asRecord(result);
  return (
    firstTextLine(payload.text) ??
    firstTextLine(payload.outputText) ??
    firstTextLine(payload.message)
  );
}

function standardCommitMessageAllowed(
  input: ApproveAndMergeInput,
  message: string | undefined,
) {
  if (!message) return false;
  return !commitMessageConventionEnabled(input) || !looksFrench(message);
}

function fallbackCommitSubject(title: string) {
  const subject = title
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/g, "");
  if (!subject) return "complete backlog item";
  return subject.charAt(0).toLowerCase() + subject.slice(1);
}

function fallbackEnglishCommitSubject(files: string[]) {
  if (
    files.length &&
    files.every((file) => /\.(test|spec)\.[jt]sx?$/.test(file))
  )
    return "cover story changes";
  if (files.length && files.every((file) => /\.(md|mdx|txt)$/.test(file)))
    return "document story changes";
  return "apply story changes";
}

function commitMessageConventionEnabled(input: ApproveAndMergeInput) {
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

function looksFrench(message: string) {
  const normalized = message.toLowerCase();
  return (
    /[àâçéèêëîïôùûüÿœ]/.test(normalized) ||
    /\b(avec|ajoute|ajouter|corrige|corriger|complète|completer|compléter|des|données|pour|sur|une)\b/.test(
      normalized,
    )
  );
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

async function mergeConflictPrompt(
  input: ApproveAndMergeInput,
  targetBranch: string,
  attempt: number,
) {
  const [status, files] = await Promise.all([
    storyStatus(input.worktree, "--short"),
    git(input.worktree, ["diff", "--name-only", "--diff-filter=U"]),
  ]);
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
  ].join("\n");
}

async function storyStatus(cwd: string, format: "--porcelain" | "--short") {
  const envPathspecs = (await changedRuntimeEnvPaths(cwd)).map(
    (path) => `:!${path}`,
  );
  return git(cwd, [
    "status",
    format,
    "--",
    ".",
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
  return {
    providerId: input.providerId,
    modelId: input.modelId,
    mode: input.mode ?? "act",
    maxIterations: input.maxIterations ?? defaultSessionMaxIterations,
    ...promptMetadata(input.prompt),
  };
}

function sessionContext(
  input: StartSessionInput,
  sessionId: string,
): ProductionSessionContext {
  return {
    maxIterations: input.maxIterations ?? defaultSessionMaxIterations,
    mode: input.mode ?? "act",
    modelId: input.modelId,
    providerId: input.providerId,
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

async function appendLog(file: string, message: string, payload?: unknown) {
  try {
    await mkdir(dirname(file), { recursive: true });
    await appendFile(
      file,
      `${JSON.stringify(logLine(message, safeLogPayload(payload)))}\n`,
      "utf8",
    );
  } catch {
    console.warn("[blame-agent]", "log write failed");
  }
}

function logLine(message: string, payload?: unknown) {
  return {
    ts: new Date().toISOString(),
    message,
    payload,
  };
}

function resultFailureMessage(result: unknown) {
  const payload = asRecord(result);
  const status = resultStatus(payload);
  if (
    !status ||
    !["failed", "error", "cancelled", "aborted", "mistake_limit"].includes(
      status,
    )
  )
    return undefined;
  const message =
    stringValue(payload.error) ??
    stringValue(payload.message) ??
    firstTextLine(payload.text);
  return message
    ? `Cline send ended with status ${status}: ${message}`
    : `Cline send ended with status ${status}.`;
}

function resultStatus(payload: Record<string, unknown>) {
  return (
    stringValue(payload.status) ??
    stringValue(payload.state) ??
    stringValue(payload.finishReason) ??
    stringValue(payload.reason)
  );
}

function initializationToolPolicies() {
  return Object.fromEntries([
    ["submit_project_initialization", { autoApprove: true }],
    ...readTools.map((name) => [name, { autoApprove: true }]),
    ...writeTools.map((name) => [name, { enabled: false, autoApprove: false }]),
  ]);
}

function normalizeHookEvent(
  event: Extract<CoreSessionEvent, { type: "hook" }>,
  fallbackSessionId: string,
): AgentEvent {
  const type = event.payload.hookEventName === "agent_error" ? "error" : "tool";
  return {
    type,
    sessionId: event.payload.sessionId ?? fallbackSessionId,
    payload: event.payload,
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

function normalizeClineAgentPayload(
  payload: Record<string, unknown>,
  sessionId: string,
  raw: unknown,
): AgentEvent {
  const type = stringValue(payload.type);

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
        reason: stringValue(payload.reason),
        text: stringValue(payload.text),
        usage: payload.usage,
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
    const error = asRecord(payload.error);
    return {
      type: "error",
      sessionId,
      payload: {
        message: stringValue(error.message) ?? "Agent session failed",
        raw,
      },
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

function duplicateEventSignature(event: AgentEvent) {
  if (event.type === "raw") return undefined;
  const payload = asRecord(event.payload);
  const text = eventText(payload);
  const tool = toolNameFromPayload(payload);
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
  return {
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalCacheReadTokens: usage.cacheReadTokens,
    totalCacheWriteTokens: usage.cacheWriteTokens,
    totalCost: usage.totalCost,
    totalInputTokens: usage.inputTokens,
    totalOutputTokens: usage.outputTokens,
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
        accumulatedText:
          stringValue(payload.accumulated) ?? stringValue(payload.reasoning),
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
      accumulatedText: stringValue(payload.accumulated),
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
  return normalizeContentEvent(payload, sessionId, raw);
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
