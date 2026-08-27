import {
  createDefaultTools,
  type AgentTool,
  type AgentToolContext,
} from "@cline/sdk";
import {
  ConversationMemoryStore,
  type CompletionState,
  type DeclaredTask,
} from "./conversation-memory.js";
import type {
  SemanticWorkspaceExecutionRequest,
  SemanticWorkspaceExecutor,
} from "./semantic-executor.js";
import { harnessError } from "./protocol.js";
import { readTaskCatalog } from "./task-catalog.js";

export const nativeCompletionToolName = "submit_and_exit";

export type NativeCompletionNotification = {
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
  sourceRevisionId: string;
  taskId: string;
  taskKind: DeclaredTask["taskKinds"][number];
};

type ValidationOutcome =
  | { status: "passed" }
  | { message: string; status: "repairable" | "unavailable" };

export class CompletionCoordinator {
  private readonly attemptedRevisions = new Set<string>();
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
    const outcome = await this.validate(state, context);
    if (outcome.status === "repairable") throw new Error(outcome.message);
    const verified = outcome.status === "passed";
    const visibleSummary = completionSummary(summary, outcome);
    await this.persistCompletion(visibleSummary, context);
    await this.options.onComplete?.({ summary: visibleSummary, verified });
    return visibleSummary;
  }

  private async validate(
    state: CompletionState,
    context: AgentToolContext,
  ): Promise<ValidationOutcome> {
    if (!state.requiredValidation) return { status: "passed" };
    if (this.options.automaticValidation === false)
      return unavailable("automatic validation coordination is disabled");
    const validation = await resolveValidation(
      this.options.workspaceRoot,
      state.requiredValidation,
    );
    if (!validation)
      return unavailable("no supported declared validation task was found");
    if (
      this.attemptedRevisions.has(validation.sourceRevisionId) ||
      validationAlreadyAttempted(state, validation)
    )
      return unavailable(
        "the required validation was already attempted for this revision",
      );
    this.attemptedRevisions.add(validation.sourceRevisionId);
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
      if (result.status === "error") return unavailable(result.error.message);
      return validationOutcome(result.data);
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
      );
    }
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

async function resolveValidation(
  workspaceRoot: string,
  requirement: DeclaredTask,
): Promise<ResolvedValidation | undefined> {
  if (!requirement.sourceRevisionId || !requirement.taskKinds.length)
    return undefined;
  const catalog = await readTaskCatalog(workspaceRoot);
  const task = catalog
    .filter(({ kind }) => requirement.taskKinds.includes(kind as never))
    .sort(
      (left, right) =>
        validationTaskScore(right, requirement) -
        validationTaskScore(left, requirement),
    )[0];
  if (!task) return undefined;
  return {
    sourceRevisionId: requirement.sourceRevisionId,
    taskId: task.task_id,
    taskKind: task.kind as DeclaredTask["taskKinds"][number],
  };
}

function validationTaskScore(
  task: Awaited<ReturnType<typeof readTaskCatalog>>[number],
  requirement: DeclaredTask,
) {
  const pathScore = requirement.files.every((path) =>
    task.cwd === "." ? true : path.startsWith(`${task.cwd}/`),
  )
    ? task.cwd.length
    : -1_000;
  const kindScore = ["typecheck", "test", "lint", "build", "custom"].indexOf(
    task.kind,
  );
  const prismaScore =
    requirement.reason === "prisma" && /prisma|validate/iu.test(task.task_id)
      ? 1_000
      : 0;
  return prismaScore + pathScore - kindScore;
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
      network: "deny",
    },
    taskContract: options.taskContract,
    tool: "run_task",
    toolContext: {
      ...(context.sessionId ? { sessionId: context.sessionId } : {}),
      ...(context.toolCallId
        ? { toolCallId: `${context.toolCallId}:validation` }
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
    toolCallId: `${context.toolCallId ?? context.runId ?? context.iteration}:validation`,
  };
}

function validationOutcome(data: unknown): ValidationOutcome {
  const value = recordValue(data);
  if (value.status === "passed") return { status: "passed" };
  if (value.status === "failed")
    return {
      status: "repairable",
      message: compactValidationFailure(value),
    };
  return unavailable(
    stringValue(value.stderr_summary) ??
      `validation ended with status ${String(value.status ?? "unknown")}`,
  );
}

function validationAlreadyAttempted(
  state: CompletionState,
  validation: ResolvedValidation,
) {
  return (
    state.latestValidation?.sourceRevisionId === validation.sourceRevisionId &&
    state.latestValidation.taskId === validation.taskId
  );
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

function unavailable(message: string): ValidationOutcome {
  return { status: "unavailable", message: compactText(message) };
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
