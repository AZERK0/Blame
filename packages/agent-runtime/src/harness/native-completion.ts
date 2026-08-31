import {
  EvidencePlanner,
  capabilitySnapshot,
  completionLifecycleTerminal,
  deriveCompletionDecision,
  evidencePlannerPolicyVersion,
  type CompletionDecision,
  type AcceptanceCriterion,
  type DeclaredTask as CoreDeclaredTask,
  type EditGroupReceipt,
  type EvidencePlan,
  type EvidencePlannedCheck,
  type ExistingEvidence,
} from "@blame/harness-core";
import {
  createDefaultTools,
  type AgentTool,
  type AgentToolContext,
} from "@cline/sdk";
import {
  ConversationMemoryStore,
  type CompletionState,
} from "./conversation-memory.js";
import type {
  SemanticWorkspaceExecutionRequest,
  SemanticWorkspaceExecutor,
} from "./semantic-executor.js";
import { harnessError, sha256 } from "./protocol.js";
import { validateContent } from "./content-validation.js";
import { environmentSpec } from "./environment-service.js";
import { readTaskCatalog } from "./task-catalog.js";
import { WorkspaceFiles } from "./workspace-files.js";

export const nativeCompletionToolName = "submit_and_exit";

export type NativeCompletionNotification = {
  completion: CompletionDecision;
  summary: string;
  verified: boolean;
};

export type NativeValidationActivity = {
  output?: unknown;
  phase: "cancelled" | "finished" | "started";
  request: SemanticWorkspaceExecutionRequest;
  toolCallId: string;
};

type ResolvedValidation = {
  environmentRevisionId: string;
  selectedPaths: string[];
  sourceRevisionId: string;
  taskId: string;
  taskKind: CoreDeclaredTask["kind"];
};

type ValidationOutcome =
  | { evidence: ExistingEvidence[]; status: "passed" }
  | {
      evidence: ExistingEvidence[];
      message: string;
      status: "repairable" | "unavailable";
    };

export class CompletionCoordinator {
  private readonly attemptedChecks = new Set<string>();
  private readonly executor: SemanticWorkspaceExecutor;
  private readonly memory: ConversationMemoryStore;
  private readonly options: NativeCompletionOptions;

  constructor(options: NativeCompletionOptions) {
    this.options = options;
    this.executor = options.executor;
    this.memory = new ConversationMemoryStore(
      options.workspaceRoot,
      options.conversationId,
    );
  }

  async submit(
    summary: string,
    _claimedVerified: boolean,
    context: AgentToolContext,
  ) {
    const state = await this.memory.completionState();
    const plan = await completionEvidencePlan(
      this.options.workspaceRoot,
      state,
      [],
      this.options.taskContract,
    );
    const outcome = await this.validate(state, plan, context);
    if (outcome.status === "repairable") throw new Error(outcome.message);
    const refreshedState = await this.memory.completionState();
    const completion = await completionDecision(
      this.options.workspaceRoot,
      refreshedState,
      outcome.evidence,
      this.options.taskContract,
    );
    if (completion.delivery !== "satisfied")
      throw new Error(
        `Completion refused: delivery is ${completion.delivery}. Resolve the remaining edit groups before submitting.`,
      );
    if (completionLifecycleTerminal(completion) === "failed")
      throw new Error(
        "Completion refused: required verification failed. Repair the failed obligations and produce evidence on a new source revision.",
      );
    const verified = ["not_applicable", "verified"].includes(
      completion.verification,
    );
    const visibleSummary = completionSummary(summary, outcome);
    await this.persistCompletion(visibleSummary, context);
    await this.options.onComplete?.({
      completion,
      summary: visibleSummary,
      verified,
    });
    return visibleSummary;
  }

  private async validate(
    state: CompletionState,
    plan: EvidencePlan,
    context: AgentToolContext,
  ): Promise<ValidationOutcome> {
    if (!plan.selected_checks.length) return { evidence: [], status: "passed" };
    if (this.options.automaticValidation === false)
      return unavailable(
        "automatic validation coordination is disabled",
        unavailableCheckEvidence(plan),
      );
    const validations = await resolvePlannedValidations(
      this.options.workspaceRoot,
      plan,
    );
    const evidence: ExistingEvidence[] = [];
    const unavailableMessages: string[] = [];
    for (const validation of validations) {
      const outcome = await this.validateCheck(state, validation, context);
      evidence.push(...outcome.evidence);
      if (outcome.status === "repairable") return { ...outcome, evidence };
      if (outcome.status === "unavailable")
        unavailableMessages.push(outcome.message);
    }
    if (unavailableMessages.length)
      return unavailable(unavailableMessages.join("; "), evidence);
    return { evidence, status: "passed" };
  }

  private async validateCheck(
    state: CompletionState,
    validation: ResolvedValidation,
    context: AgentToolContext,
  ): Promise<ValidationOutcome> {
    const identity = automaticValidationId(validation);
    if (
      this.attemptedChecks.has(identity) ||
      validationAlreadyAttempted(state, validation)
    )
      return unavailable(
        "the planned validation was already attempted for this revision",
        [persistedValidationEvidence(state, validation)],
      );
    this.attemptedChecks.add(identity);
    if (validation.taskId.startsWith("native:parse:"))
      return this.executeNativeValidation(validation);
    return this.executeValidation(validation, context);
  }

  private async executeValidation(
    validation: ResolvedValidation,
    context: AgentToolContext,
  ): Promise<ValidationOutcome> {
    const activity = validationActivity(this.options, validation, context);
    await this.publishValidation({ ...activity, phase: "started" });
    try {
      const result = await this.executor(activity.request, context.signal);
      context.signal?.throwIfAborted();
      await this.recordValidation(validation, result);
      await this.publishValidation({
        ...activity,
        output: result,
        phase: "finished",
      });
      if (result.status === "error")
        return unavailable(result.error.message, [
          validationEvidence(validation, "unavailable"),
        ]);
      return validationOutcome(result.data, validation);
    } catch (error) {
      if (context.signal?.aborted) {
        await this.publishValidation({ ...activity, phase: "cancelled" });
        context.signal.throwIfAborted();
      }
      context.signal?.throwIfAborted();
      await this.recordUnavailableValidation(validation);
      await this.publishValidation({
        ...activity,
        output: harnessError({
          code: "EXECUTION_ERROR",
          message: error instanceof Error ? error.message : String(error),
        }),
        phase: "finished",
      });
      return unavailable(
        error instanceof Error ? error.message : String(error),
        [validationEvidence(validation, "unavailable")],
      );
    }
  }

  private async executeNativeValidation(
    validation: ResolvedValidation,
  ): Promise<ValidationOutcome> {
    const files = new WorkspaceFiles(this.options.workspaceRoot);
    const results = await nativeValidationResults(
      files,
      validation.selectedPaths,
      this.options.workspaceRoot,
      validation.sourceRevisionId,
    );
    const failed = results.filter(({ status }) => status === "failed");
    const status = failed.length ? "failed" : "passed";
    const evidence = validationEvidence(validation, status, {
      diagnostics: failed.flatMap(({ diagnostics }) => diagnostics),
    });
    await this.recordNativeValidation(validation, evidence, status);
    return nativeValidationOutcome(evidence, failed);
  }

  private recordNativeValidation(
    validation: ResolvedValidation,
    evidence: ExistingEvidence,
    status: "failed" | "passed",
  ) {
    return this.memory.recordValidation({
      id: evidence.evidence_ref,
      sourceRevisionId: validation.sourceRevisionId,
      status,
      taskId: validation.taskId,
      taskKind: validation.taskKind,
      terminal: status,
    });
  }

  private publishValidation(activity: NativeValidationActivity) {
    return this.options.onValidationActivity?.(activity);
  }

  private recordValidation(
    validation: ResolvedValidation,
    result: Awaited<ReturnType<SemanticWorkspaceExecutor>>,
  ) {
    const data = result.status === "success" ? recordValue(result.data) : {};
    const status =
      result.status === "error"
        ? `error:${result.error.code}`
        : (stringValue(data.status) ?? "unknown");
    return this.memory.recordValidation({
      id: stringValue(data.run_ref) ?? automaticValidationId(validation),
      sourceRevisionId: validation.sourceRevisionId,
      status,
      taskId: validation.taskId,
      taskKind: validation.taskKind,
      terminal: validationTerminal(status),
    });
  }

  private recordUnavailableValidation(validation: ResolvedValidation) {
    return this.memory.recordValidation({
      id: automaticValidationId(validation),
      sourceRevisionId: validation.sourceRevisionId,
      status: "unavailable",
      taskId: validation.taskId,
      taskKind: validation.taskKind,
      terminal: "unknown",
    });
  }

  private async persistCompletion(summary: string, context: AgentToolContext) {
    const reference = context.toolCallId
      ? `assistant-turn://${context.toolCallId}`
      : `assistant-turn://${context.runId ?? context.iteration}`;
    await this.memory.completeNativeTurn(summary, reference);
  }
}

function nativeValidationResults(
  files: WorkspaceFiles,
  paths: string[],
  workspaceRoot: string,
  sourceRevisionId: string,
) {
  return files.snapshot().then((snapshot) => {
    if (snapshot.revision.source_revision_id !== sourceRevisionId)
      throw new Error("SOURCE_REVISION_CHANGED_DURING_EVIDENCE_PLANNING");
    return Promise.all(
      paths.map(async (path) =>
        validateContent({
          content: (await files.read(path)).content,
          path,
          workspaceRoot,
        }),
      ),
    );
  });
}

function nativeValidationOutcome(
  evidence: ExistingEvidence,
  failed: Awaited<ReturnType<typeof nativeValidationResults>>,
): ValidationOutcome {
  if (!failed.length) return { evidence: [evidence], status: "passed" };
  const detail = failed
    .flatMap(({ diagnostics }) => diagnostics)
    .slice(0, 3)
    .join("; ");
  return {
    evidence: [evidence],
    message: `Automatic parse validation failed: ${detail}`,
    status: "repairable",
  };
}

type NativeCompletionOptions = {
  automaticValidation?: boolean;
  conversationId: string;
  executor: SemanticWorkspaceExecutor;
  onComplete?(notification: NativeCompletionNotification): Promise<void> | void;
  onValidationActivity?(
    activity: NativeValidationActivity,
  ): Promise<void> | void;
  taskContract?: SemanticWorkspaceExecutionRequest["taskContract"];
  workspaceRoot: string;
};

export function createNativeCompletionTool(
  options: NativeCompletionOptions,
): AgentTool {
  const coordinator = new CompletionCoordinator(options);
  const tools = createDefaultTools({
    executors: {
      submit: (summary: string, verified: boolean, context: AgentToolContext) =>
        coordinator.submit(summary, verified, context),
    },
    enableApplyPatch: false,
    enableAskQuestion: false,
    enableBash: false,
    enableEditor: false,
    enableReadFiles: false,
    enableSearch: false,
    enableSkills: false,
    enableSubmitAndExit: true,
    enableWebFetch: false,
  });
  const tool = tools.find(
    ({ name }: AgentTool) => name === nativeCompletionToolName,
  );
  if (!tool) throw new Error("Cline submit_and_exit tool is unavailable.");
  return tool;
}

async function resolvePlannedValidations(
  workspaceRoot: string,
  plan: EvidencePlan,
) {
  const catalog = await readTaskCatalog(workspaceRoot);
  const tasks = new Map(catalog.map((task) => [task.task_id, task]));
  return plan.selected_checks.flatMap((check): ResolvedValidation[] => {
    const task = tasks.get(check.task_id);
    const native = check.task_id.startsWith("native:parse:");
    if (!native && (!task || !coreTaskKind(task.kind))) return [];
    return [
      {
        environmentRevisionId: plan.environment_revision_id,
        selectedPaths: check.selected_paths,
        sourceRevisionId: plan.source_revision_id,
        taskId: check.task_id,
        taskKind: native
          ? "custom"
          : (task!.kind as ResolvedValidation["taskKind"]),
      },
    ];
  });
}

function validationRequest(
  options: NativeCompletionOptions,
  validation: ResolvedValidation,
  context: AgentToolContext,
): SemanticWorkspaceExecutionRequest {
  return {
    input: {
      source_revision_id: validation.sourceRevisionId,
      task: { task_id: validation.taskId },
      limits: { timeout_ms: 120_000, output_bytes: 64 * 1024 },
    },
    taskContract: options.taskContract,
    tool: "run_task",
    toolContext: {
      ...(context.sessionId ? { sessionId: context.sessionId } : {}),
      ...(context.toolCallId
        ? {
            toolCallId: `${context.toolCallId}:validation:${sha256(validation.taskId).slice(0, 8)}`,
          }
        : {}),
    },
    workspaceRoot: options.workspaceRoot,
  };
}

function validationActivity(
  options: NativeCompletionOptions,
  validation: ResolvedValidation,
  context: AgentToolContext,
): Omit<NativeValidationActivity, "phase"> {
  return {
    request: validationRequest(options, validation, context),
    toolCallId: `${context.toolCallId ?? context.runId ?? context.iteration}:validation:${sha256(validation.taskId).slice(0, 8)}`,
  };
}

function validationOutcome(
  data: unknown,
  validation: ResolvedValidation,
): ValidationOutcome {
  const value = recordValue(data);
  if (value.status === "passed")
    return {
      status: "passed",
      evidence: [validationEvidence(validation, "passed", value)],
    };
  if (value.status === "failed")
    return {
      status: "repairable",
      message: compactValidationFailure(value),
      evidence: [validationEvidence(validation, "failed", value)],
    };
  return unavailable(
    stringValue(value.stderr_summary) ??
      `validation ended with status ${String(value.status ?? "unknown")}`,
    [validationEvidence(validation, "unavailable", value)],
  );
}

function validationEvidence(
  validation: ResolvedValidation,
  status: ExistingEvidence["status"],
  data: Record<string, unknown> = {},
): ExistingEvidence {
  return {
    evidence_ref:
      stringValue(data.run_ref) ?? automaticValidationId(validation),
    check_id: validation.taskId,
    status,
    source_revision_id: validation.sourceRevisionId,
    environment_revision_id: validation.environmentRevisionId,
    paths: validation.selectedPaths,
    policy_version: evidencePlannerPolicyVersion,
  };
}

function validationAlreadyAttempted(
  state: CompletionState,
  validation: ResolvedValidation,
) {
  return state.validations.some(
    (receipt) =>
      receipt.sourceRevisionId === validation.sourceRevisionId &&
      receipt.taskId === validation.taskId,
  );
}

function persistedValidationEvidence(
  state: CompletionState,
  validation: ResolvedValidation,
) {
  const receipt = state.validations.find(
    (candidate) =>
      candidate.sourceRevisionId === validation.sourceRevisionId &&
      candidate.taskId === validation.taskId,
  );
  return validationEvidence(
    validation,
    validationEvidenceStatus(receipt?.terminal ?? "unknown"),
  );
}

function unavailableCheckEvidence(plan: EvidencePlan) {
  return plan.selected_checks.map((check) =>
    validationEvidence(
      plannedValidation(
        plan.source_revision_id,
        plan.environment_revision_id,
        check,
      ),
      "unavailable",
    ),
  );
}

function plannedValidation(
  sourceRevisionId: string,
  environmentRevisionId: string,
  check: EvidencePlannedCheck,
): ResolvedValidation {
  return {
    environmentRevisionId,
    selectedPaths: check.selected_paths,
    sourceRevisionId,
    taskId: check.task_id,
    taskKind: "custom",
  };
}

function automaticValidationId(validation: ResolvedValidation) {
  return `automatic-validation://${validation.sourceRevisionId}/${validation.taskId}`;
}

function validationTerminal(status: string) {
  if (status === "passed") return "passed" as const;
  if (status === "failed") return "failed" as const;
  return "unknown" as const;
}

function compactValidationFailure(value: Record<string, unknown>) {
  const failures = Array.isArray(value.failures)
    ? value.failures
        .slice(0, 3)
        .map((failure) => stringValue(recordValue(failure).message))
        .filter(Boolean)
    : [];
  const detail = failures.join("; ") || "the declared validation failed";
  return `Automatic validation found a repairable code error: ${detail}. Correct it once, then submit again.`;
}

async function completionDecision(
  workspaceRoot: string,
  state: CompletionState,
  outcomeEvidence: ExistingEvidence[] = [],
  taskContract?: SemanticWorkspaceExecutionRequest["taskContract"],
) {
  const plan = await completionEvidencePlan(
    workspaceRoot,
    state,
    outcomeEvidence,
    taskContract,
  );
  const changes = uniqueChanges([
    ...state.coveredChanges,
    ...state.dirtyChanges,
  ]);
  return deriveCompletionDecision({
    source_revision_id: plan.source_revision_id,
    edit_groups: completionEditGroups(changes, plan.source_revision_id),
    evidence_plan: plan,
    non_mutating_intent_satisfied: taskContract?.effect_requirement === "none",
  });
}

async function completionEvidencePlan(
  workspaceRoot: string,
  state: CompletionState,
  outcomeEvidence: ExistingEvidence[],
  taskContract?: SemanticWorkspaceExecutionRequest["taskContract"],
) {
  const changes = uniqueChanges([
    ...state.coveredChanges,
    ...state.dirtyChanges,
  ]);
  const revision = await completionRevision(workspaceRoot, state, changes);
  const files = new WorkspaceFiles(workspaceRoot);
  const snapshot = await files.snapshot();
  const environment = await environmentSpec(files, snapshot);
  const paths = unique(changes.flatMap((change) => change.files));
  const capabilityLanguages = capabilitySnapshot(paths);
  const snapshotId = `capability://${sha256(JSON.stringify(capabilityLanguages))}`;
  return new EvidencePlanner().plan({
    source_revision_id: revision,
    environment_revision_id: environment.environment_spec_revision_id,
    change_receipts: changes.map((change) => change.id),
    changed_files: paths,
    changed_symbols: changedSymbols(changes),
    semantic_diff: semanticDiff(paths, changes),
    bounded_relations: await boundedRelations(workspaceRoot, changes),
    task_catalog: await completionTasks(workspaceRoot),
    acceptance_criteria: acceptanceCriteria(taskContract),
    existing_evidence: [
      ...completionEvidence(
        state,
        changes,
        capabilityLanguages,
        environment.environment_spec_revision_id,
      ),
      ...outcomeEvidence,
    ],
    capability_snapshot: {
      snapshot_id: snapshotId,
      languages: capabilityLanguages,
    },
    capability_snapshot_id: snapshotId,
    policy_version: evidencePlannerPolicyVersion,
  });
}

async function completionRevision(
  workspaceRoot: string,
  state: CompletionState,
  changes: CompletionState["dirtyChanges"],
) {
  const changeRevision = [...changes]
    .reverse()
    .find((change) => change.sourceRevisionId)?.sourceRevisionId;
  return (
    state.requiredValidation?.sourceRevisionId ??
    state.latestValidation?.sourceRevisionId ??
    changeRevision ??
    (await new WorkspaceFiles(workspaceRoot).snapshot()).revision
      .source_revision_id
  );
}

async function completionTasks(workspaceRoot: string) {
  const catalog = await readTaskCatalog(workspaceRoot);
  return catalog.flatMap((task): CoreDeclaredTask[] => {
    if (!coreTaskKind(task.kind)) return [];
    return [
      {
        task_id: task.task_id,
        kind: task.kind,
        cwd: task.cwd,
        supports_file_selection: task.supportsFileSelection,
        reliability: "high",
        cost: taskCost(task.kind),
      },
    ];
  });
}

function completionEvidence(
  state: CompletionState,
  changes: CompletionState["dirtyChanges"],
  languages: ReturnType<typeof capabilitySnapshot>,
  environmentRevisionId: string,
) {
  const parseEvidence = changes.flatMap((change) =>
    change.validation === "passed"
      ? parseChangeEvidence(change, languages, environmentRevisionId)
      : [],
  );
  return [
    ...parseEvidence,
    ...state.validations.flatMap((receipt): ExistingEvidence[] =>
      receipt.taskId && receipt.sourceRevisionId
        ? [
            {
              evidence_ref: receipt.id,
              check_id: receipt.taskId,
              status: validationEvidenceStatus(receipt.terminal),
              source_revision_id: receipt.sourceRevisionId,
              environment_revision_id: environmentRevisionId,
              paths: [],
              policy_version: evidencePlannerPolicyVersion,
            },
          ]
        : [],
    ),
  ];
}

function parseChangeEvidence(
  change: CompletionState["dirtyChanges"][number],
  languages: ReturnType<typeof capabilitySnapshot>,
  environmentRevisionId: string,
): ExistingEvidence[] {
  if (!change.sourceRevisionId) return [];
  const pathsByLanguage = new Map<string, Set<string>>();
  for (const language of languages) {
    const paths = change.files.filter((path) =>
      language.extensions.includes(fileExtension(path)),
    );
    const current = pathsByLanguage.get(language.language_id) ?? new Set();
    paths.forEach((path) => current.add(path));
    pathsByLanguage.set(language.language_id, current);
  }
  return [...pathsByLanguage].flatMap(([languageId, paths]) =>
    paths.size
      ? [
          parseEvidence(
            change,
            languageId,
            [...paths].sort(),
            environmentRevisionId,
          ),
        ]
      : [],
  );
}

function parseEvidence(
  change: CompletionState["dirtyChanges"][number],
  languageId: string,
  paths: string[],
  environmentRevisionId: string,
): ExistingEvidence {
  return {
    evidence_ref: `evidence://parse/${sha256(`${change.id}\0${languageId}`)}`,
    check_id: `native:parse:${languageId}`,
    status: "passed",
    source_revision_id: change.sourceRevisionId,
    environment_revision_id: environmentRevisionId,
    paths,
    policy_version: evidencePlannerPolicyVersion,
  };
}

function completionEditGroups(
  changes: CompletionState["dirtyChanges"],
  revision: string,
): EditGroupReceipt[] {
  return changes.map((change, index) => ({
    group_id: `completion-group://${sha256(change.id).slice(0, 24)}`,
    operation_indexes: [index],
    effective_paths: [...change.files],
    outcome: "applied",
    effect: "changed",
    satisfaction: "satisfied",
    receipt_ref: change.id,
    source_revision_before: change.sourceRevisionId ?? revision,
    source_revision_after: change.sourceRevisionId ?? revision,
  }));
}

function changedSymbols(changes: CompletionState["dirtyChanges"]) {
  return changes.flatMap((change) =>
    change.symbols.map((symbol) => ({
      path: change.files[0] ?? "unknown",
      symbol,
      visibility: "unknown" as const,
      change: "body" as const,
    })),
  );
}

function semanticDiff(
  paths: string[],
  changes: CompletionState["dirtyChanges"],
) {
  return {
    public_api_changed:
      changes.some((change) => change.symbols.length > 0) ||
      paths.some((path) => /(?:^|\/)(?:index|public)\.[^/]+$/u.test(path)),
    data_schema_changed: paths.some((path) =>
      /(?:\.prisma|migrations?\/)/u.test(path),
    ),
    dependency_changed: paths.some((path) =>
      /(?:^|\/)(?:package\.json|[^/]+-lock\.|pnpm-lock\.|yarn\.lock)/u.test(
        path,
      ),
    ),
    configuration_changed: paths.some((path) =>
      /(?:^|\/)(?:tsconfig|vite\.config|next\.config|webpack\.config|\.env)/u.test(
        path,
      ),
    ),
    ui_changed: paths.some((path) => /\.(?:css|html|jsx|tsx|vue)$/u.test(path)),
  };
}

function acceptanceCriteria(
  taskContract: SemanticWorkspaceExecutionRequest["taskContract"],
): AcceptanceCriterion[] {
  return (taskContract?.acceptance_criteria ?? []).flatMap((text, index) => {
    const normalized = text.trim();
    if (!normalized) return [];
    return [
      {
        criterion_id: `task-contract-${index + 1}`,
        text: normalized,
        automatable: true,
        required_checks: ["test"],
      },
    ];
  });
}

async function boundedRelations(
  workspaceRoot: string,
  changes: CompletionState["dirtyChanges"],
) {
  const symbols = unique(changes.flatMap((change) => change.symbols));
  if (!symbols.length) return { consumers: [], bounded: true };
  const files = new WorkspaceFiles(workspaceRoot);
  const snapshot = await files.snapshot();
  const changedPaths = new Set(changes.flatMap((change) => change.files));
  const candidates = snapshot.files.filter(
    (path) => !changedPaths.has(path) && sourceLikePath(path),
  );
  const consumers = await findConsumers(
    files,
    candidates.slice(0, 200),
    symbols,
  );
  return {
    consumers: consumers.slice(0, 200),
    bounded: candidates.length <= 200 && consumers.length <= 200,
  };
}

async function findConsumers(
  files: WorkspaceFiles,
  paths: string[],
  symbols: string[],
) {
  const consumers: Array<{
    source_symbol: string;
    target_symbol: string;
    path: string;
  }> = [];
  for (const path of paths) {
    const content = (await files.read(path)).content.toString("utf8");
    for (const symbol of symbols)
      if (symbolMentioned(content, symbol))
        consumers.push({ source_symbol: path, target_symbol: symbol, path });
    if (consumers.length > 200) break;
  }
  return consumers;
}

function symbolMentioned(content: string, symbol: string) {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "u").test(content);
}

function sourceLikePath(path: string) {
  return /\.(?:[cm]?[jt]sx?|css|go|java|py|rs|vue)$/iu.test(path);
}

function validationEvidenceStatus(
  terminal: "failed" | "passed" | "pending" | "unknown",
) {
  if (terminal === "passed") return "passed" as const;
  if (terminal === "failed") return "failed" as const;
  return "unavailable" as const;
}

function uniqueChanges(changes: CompletionState["dirtyChanges"]) {
  return [...new Map(changes.map((change) => [change.id, change])).values()];
}

function coreTaskKind(value: string): value is CoreDeclaredTask["kind"] {
  return ["build", "custom", "lint", "test", "typecheck"].includes(value);
}

function taskCost(kind: CoreDeclaredTask["kind"]) {
  const duration = {
    lint: 1_000,
    typecheck: 2_000,
    test: 4_000,
    custom: 6_000,
    build: 10_000,
  }[kind];
  return {
    duration_ms: duration,
    compute_units: Math.max(1, duration / 1_000),
  };
}

function fileExtension(path: string) {
  return path.toLowerCase().match(/\.[^.]+$/u)?.[0] ?? "";
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function unavailable(
  message: string,
  evidence: ExistingEvidence[] = [],
): ValidationOutcome {
  return {
    evidence,
    status: "unavailable",
    message: compactText(message),
  };
}

function completionSummary(summary: string, outcome: ValidationOutcome) {
  if (outcome.status !== "unavailable") return summary;
  return `${summary.trim()}\n\nValidation non confirmée : ${outcome.message}.`;
}

function compactText(value: string) {
  return value.replace(/\s+/gu, " ").trim().slice(0, 300);
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
