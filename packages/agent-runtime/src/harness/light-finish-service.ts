import type { CompletionDecision } from "@blame/harness-core";
import type { AgentToolContext } from "@cline/sdk";
import type {
  LightCompletionNotification,
  LightValidationActivity,
} from "./light-completion.js";
import type {
  LightRunTaskInput,
  LightTaskContract,
  LightToolResult,
} from "./light-contracts.js";
import { LightTaskRunner } from "./light-task-runner.js";
import { SessionJournal } from "./session-journal.js";
import { readTaskCatalog } from "./task-catalog.js";
import { WorkspaceFiles } from "./workspace-files.js";

export type LocalFinishOptions = {
  conversationId: string;
  onComplete?(notification: LightCompletionNotification): Promise<void> | void;
  onValidationActivity?(
    activity: LightValidationActivity,
  ): Promise<void> | void;
  taskContract?: LightTaskContract;
  workspaceRoot: string;
};

type LocalFinishTaskInput = {
  context: AgentToolContext;
  input: unknown;
  taskContract?: LightTaskContract;
  workspaceRoot: string;
};

export async function executeLocalFinishTask(
  input: LocalFinishTaskInput,
): Promise<LightToolResult<unknown>> {
  const value = recordValue(input.input);
  if (typeof value.summary !== "string")
    return blockedFinish("A finish summary is required.");
  const notifications: LightCompletionNotification[] = [];
  const validationActivities: LightValidationActivity[] = [];
  const service = createCapturedService(
    input,
    notifications,
    validationActivities,
  );
  try {
    const summary = await service.finish(value.summary, input.context);
    return {
      status: "ok",
      data: {
        notification: notifications.at(-1),
        summary,
        validationActivities,
      },
    };
  } catch (error) {
    return blockedFinish(errorMessage(error));
  }
}

export class LightFinishService {
  private readonly files: WorkspaceFiles;
  private readonly journal: SessionJournal;
  private readonly options: LocalFinishOptions;
  private readonly tasks: LightTaskRunner;

  constructor(options: LocalFinishOptions) {
    this.options = options;
    this.files = new WorkspaceFiles(options.workspaceRoot);
    this.journal = new SessionJournal(
      options.workspaceRoot,
      options.conversationId,
    );
    this.tasks = new LightTaskRunner({
      files: this.files,
      journal: this.journal,
    });
  }

  async finish(summary: string, context: AgentToolContext) {
    const initial = await this.journal.completionSnapshot();
    this.assertDelivered(initial.changedPaths);
    const validation = await this.validateIfNeeded(initial, context);
    const current = await this.journal.completionSnapshot();
    const verified = hasPassingValidation(
      current.validations,
      current.changedPaths,
      validation.taskId,
    );
    const unavailable = validation.outcome === "unavailable" || !verified;
    const decision = completionDecision(
      current.sourceRevisionId,
      verified,
      unavailable,
    );
    await this.recordCompletion(summary, decision, verified, unavailable);
    return summary;
  }

  private assertDelivered(changedPaths: string[]) {
    const required =
      this.options.taskContract?.effect_requirement === "source_change";
    if (required && !changedPaths.length)
      throw new Error("Completion requires a current source change.");
  }

  private async validateIfNeeded(
    state: Awaited<ReturnType<SessionJournal["completionSnapshot"]>>,
    context: AgentToolContext,
  ) {
    const input = await this.validationInput(state.changedPaths);
    if (!input) return { outcome: "unavailable" as const };
    if (hasPassingValidation(state.validations, state.changedPaths, input.task))
      return { outcome: "reused" as const, taskId: input.task };
    if (
      hasUnavailableValidation(state.validations, state.changedPaths, input.task)
    )
      return { outcome: "unavailable" as const, taskId: input.task };
    const result = await this.runValidation(input, context);
    if (result.status === "ok")
      return { outcome: "passed" as const, taskId: input.task };
    if (result.category === "code") throw new Error(result.message);
    return { outcome: "unavailable" as const, taskId: input.task };
  }

  private async validationInput(
    changedPaths: string[],
  ): Promise<Extract<LightRunTaskInput, { kind: "project" }> | undefined> {
    const snapshot = await this.files.snapshot();
    const catalog = await readTaskCatalog(this.files.root, snapshot.files);
    const task = selectValidationTask(catalog, changedPaths);
    return task ? { kind: "project", task: task.task_id } : undefined;
  }

  private async runValidation(
    input: Extract<LightRunTaskInput, { kind: "project" }>,
    context: AgentToolContext,
  ): Promise<LightToolResult<unknown>> {
    const toolCallId = `${context.toolCallId ?? "finish"}:validation`;
    await this.options.onValidationActivity?.({
      input,
      phase: "started",
      toolCallId,
    });
    const output = await this.tasks.run(input, context);
    await this.options.onValidationActivity?.({
      input,
      output,
      phase: "finished",
      toolCallId,
    });
    return output;
  }

  private async recordCompletion(
    summary: string,
    decision: CompletionDecision,
    verified: boolean,
    unavailable: boolean,
  ) {
    await this.journal.recordTerminal(
      unavailable ? "completed_with_validation_unavailable" : "completed",
      summary,
    );
    await this.options.onComplete?.({
      completion: decision,
      submission_outcome: "accepted",
      summary,
      verified,
    });
  }
}

function createCapturedService(
  input: LocalFinishTaskInput,
  notifications: LightCompletionNotification[],
  activities: LightValidationActivity[],
) {
  return new LightFinishService({
    conversationId: input.taskContract?.session_id ?? "unscoped-session",
    onComplete: (value) => {
      notifications.push(value);
    },
    onValidationActivity: (value) => {
      activities.push(value);
    },
    taskContract: input.taskContract,
    workspaceRoot: input.workspaceRoot,
  });
}

function selectValidationTask(
  tasks: Awaited<ReturnType<typeof readTaskCatalog>>,
  paths: string[],
) {
  const priorities = ["build", "test", "typecheck", "lint"];
  return tasks
    .filter(({ kind }) => priorities.includes(kind))
    .map((task) => ({
      task,
      score: validationTaskScore(task, paths, priorities),
    }))
    .sort((left, right) => right.score - left.score)[0]?.task;
}

function validationTaskScore(
  task: Awaited<ReturnType<typeof readTaskCatalog>>[number],
  paths: string[],
  priorities: string[],
) {
  const scope = task.cwd === "." ? "" : `${task.cwd}/`;
  const scoped = paths.filter((path) => path.startsWith(scope)).length;
  return scoped * 100 + (priorities.length - priorities.indexOf(task.kind));
}

function hasPassingValidation(
  validations: Awaited<
    ReturnType<SessionJournal["completionSnapshot"]>
  >["validations"],
  changedPaths: string[],
  taskId?: string,
) {
  if (!taskId) return false;
  return validations.some(
    ({ paths, status, taskId: validationTaskId, terminal }) =>
      status === "passed" &&
      terminal === "passed" &&
      validationTaskId === taskId &&
      changedPaths.every((path) => paths.includes(path)),
  );
}

function hasUnavailableValidation(
  validations: Awaited<
    ReturnType<SessionJournal["completionSnapshot"]>
  >["validations"],
  changedPaths: string[],
  taskId: string,
) {
  return validations.some(
    ({ category, paths, status, taskId: validationTaskId, terminal }) =>
      category === "environment" &&
      status === "failed" &&
      terminal === "failed" &&
      validationTaskId === taskId &&
      changedPaths.every((path) => paths.includes(path)),
  );
}

function completionDecision(
  sourceRevisionId: string,
  verified: boolean,
  unavailable: boolean,
): CompletionDecision {
  return {
    source_revision_id:
      sourceRevisionId as CompletionDecision["source_revision_id"],
    delivery: "satisfied",
    verification: verified ? "verified" : "not_applicable",
    satisfied_obligations: verified ? ["validation"] : [],
    missing_obligations: [],
    failed_obligations: [],
    reservations: unavailable
      ? [
          {
            code: "VALIDATION_UNAVAILABLE",
            message: "No current project validation was available.",
            obligation_ids: [],
          },
        ]
      : [],
  };
}

function blockedFinish(message: string): LightToolResult<unknown> {
  return { status: "blocked", category: "code", message };
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
