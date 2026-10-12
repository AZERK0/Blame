import { setTimeout as delay } from "node:timers/promises";
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
import { LightCommitService } from "./light-commit.js";
import { createProjectMemoryCandidate } from "./project-memory.js";
import { SessionJournal } from "./session-journal.js";
import { readTaskCatalog } from "./task-catalog.js";
import { WorkspaceFiles } from "./workspace-files.js";
import { validationScopePaths } from "./validation-scope.js";

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
    const initial = await this.completionSnapshot();
    this.assertDelivered(initial.changedPaths);
    assertNoFailedValidation(initial);
    const validation = await this.validateIfNeeded(initial, context);
    const current = await this.completionSnapshot();
    assertNoFailedValidation(current);
    const verified = hasPassingValidation(
      current.validations,
      current.changedPaths,
      validation.taskIds,
    );
    const unavailable = current.changedPaths.length > 0 && !verified;
    const decision = completionDecision(
      current.sourceRevisionId,
      verified,
      unavailable,
      current.changedPaths.length === 0,
    );
    await this.recordCompletion(
      summary,
      decision,
      verified,
      unavailable,
      current,
      validation.taskIds?.length === 1 ? validation.taskIds[0] : undefined,
    );
    return summary;
  }

  private completionSnapshot() {
    return new LightCommitService(this.files).exclusive(() =>
      this.journal.completionSnapshot(),
    );
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
    if (!state.changedPaths.length)
      return { outcome: "not_applicable" as const };
    const inputs = await this.validationInputs(state.changedPaths);
    const pendingTests = inputs.filter(({ input, cwd }) =>
      input.args !== undefined && !state.validations.some((item) => sameInvocation(item, input, cwd)),
    );
    if (pendingTests.length > 16)
      throw new Error("Automatic validation refresh is limited to 16 test selections. Refresh the requested tests with run_task before finishing.");
    for (const { input, paths, cwd } of inputs) {
      const matching = state.validations.filter((item) => sameInvocation(item, input, cwd));
      if (hasPassingValidation(matching, paths, [input.task]))
        continue;
      if (hasUnavailableValidation(matching, paths, input.task))
        continue;
      if (matching.some((validation) => validation.status === "unknown"))
        continue;
      const result = await this.runValidation(input, context);
      if (result.status === "blocked" && result.category === "code")
        throw new Error(result.message);
      if (
        result.status === "ok" &&
        recordValue(recordValue(result.data).validation).status === "stale"
      )
        throw new Error(
          "Source changed during final validation. Review the changes and validate again.",
        );
    }
    return {
      outcome: "checked" as const,
      taskIds: inputs.map(({ input }) => input.task),
    };
  }

  private async validationInputs(changedPaths: string[]) {
    const snapshot = await this.files.snapshot();
    const observations = this.journal.currentValidations();
    const attempted = new Set(observations.map(({ taskId }) => taskId));
    const catalog = (
      await readTaskCatalog(this.files.root, snapshot.files)
    ).filter(({ task_id }) => attempted.has(task_id));
    const scopes = [...new Set(catalog.map(({ cwd }) => cwd))];
    const failedTasks = latestFailedTasks(this.journal.currentValidations());
    return scopes.flatMap((cwd) => {
      const paths = validationScopePaths(changedPaths, snapshot.files, cwd);
      if (!paths.length) return [];
      const scopedTasks = catalog.filter((item) => item.cwd === cwd);
      const task = selectValidationTask(scopedTasks, paths);
      const required = scopedTasks.filter((item) =>
        failedTasks.has(item.task_id),
      );
      if (task && !required.includes(task)) required.push(task);
      // Keep every literal test selection already requested in this package.
      // A catalog ID alone cannot represent two filters of the same test task.
      const selections = new Map<string, {
        input: Extract<LightRunTaskInput, { kind: "project" }>;
        paths: string[];
        cwd: string;
      }>();
      for (const item of required.filter((item) => item.kind !== "test"))
        selections.set(item.task_id, {
          input: { kind: "project", task: item.task_id }, paths, cwd,
        });
      for (const observation of observations) {
        if (observation.cwd !== cwd || !scopedTasks.some((item) =>
          item.task_id === observation.taskId && item.kind === "test")) continue;
        const args = observation.args ?? [];
        selections.set(JSON.stringify([observation.taskId, args]), {
          input: { kind: "project", task: observation.taskId!, args: [...args] }, paths, cwd,
        });
      }
      return [...selections.values()];
    });
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
    let output = await this.tasks.run(input, context);
    // Automatic final validation owns this invocation through bounded completion.
    // A running handle is not evidence that the requested test has finished.
    while (output.status === "ok" && typeof recordValue(output.data).run === "string") {
      await delay(100, undefined, { signal: context.signal });
      const inspected = await this.tasks.run({
        kind: "inspect", run: String(recordValue(output.data).run),
      }, context);
      output = inspected.status === "ok" && recordValue(inspected.data).completed
        ? recordValue(inspected.data).completed as LightToolResult<unknown>
        : inspected;
    }
    context.signal?.throwIfAborted();
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
    state: Awaited<ReturnType<SessionJournal["completionSnapshot"]>>,
    validationTaskId?: string,
  ) {
    await this.journal.recordTerminal(
      unavailable ? "completed_with_validation_unavailable" : "completed",
      summary,
    );
    const memory =
      verified && validationTaskId
        ? this.completionMemory(summary, state, validationTaskId)
        : undefined;
    await this.options.onComplete?.({
      completion: decision,
      ...(memory ? { memory } : {}),
      submission_outcome: "accepted",
      summary,
      verified,
    });
  }

  private completionMemory(
    summary: string,
    state: Awaited<ReturnType<SessionJournal["completionSnapshot"]>>,
    validationTaskId?: string,
  ) {
    if (!state.files.length || state.files.length > 24) return undefined;
    const validation = state.validations.find(
      (item) => item.taskId === validationTaskId && item.terminal === "passed",
    );
    return createProjectMemoryCandidate({
      files: state.files,
      objective: this.options.taskContract?.objective ?? "",
      sourceRevisionId: state.sourceRevisionId,
      storyId: this.options.taskContract?.story_id,
      summary,
      symbols: state.symbols,
      validationKind: validation?.taskKind,
      validationTaskId,
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

function sameInvocation(
  validation: Awaited<ReturnType<SessionJournal["completionSnapshot"]>>["validations"][number],
  input: Extract<LightRunTaskInput, { kind: "project" }>,
  cwd: string,
) {
  return validation.taskId === input.task && (validation.cwd ?? ".") === cwd &&
    JSON.stringify(validation.args ?? []) === JSON.stringify(input.args ?? []);
}

function hasPassingValidation(
  validations: Awaited<
    ReturnType<SessionJournal["completionSnapshot"]>
  >["validations"],
  changedPaths: string[],
  taskIds?: string[],
) {
  if (!taskIds?.length || !changedPaths.length) return false;
  const paths = new Set(
    validations
      .filter(
        (validation) =>
          validation.status === "passed" &&
          validation.terminal === "passed" &&
          taskIds.includes(validation.taskId ?? ""),
      )
      .flatMap((validation) => validation.paths),
  );
  return changedPaths.every((path) => paths.has(path));
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
  nonMutating: boolean,
): CompletionDecision {
  return {
    source_revision_id:
      sourceRevisionId as CompletionDecision["source_revision_id"],
    delivery: "satisfied",
    verification: verified
      ? "verified"
      : nonMutating
        ? "not_applicable"
        : "unverified",
    satisfied_obligations: verified ? ["validation"] : [],
    missing_obligations: [],
    failed_obligations: [],
    reservations:
      unavailable && !nonMutating
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

function assertNoFailedValidation(
  state: Awaited<ReturnType<SessionJournal["completionSnapshot"]>>,
) {
  const failed = state.validations.filter(
    (validation) =>
      validation.terminal === "failed" &&
      validation.category === "code" &&
      ["build", "test", "typecheck", "lint"].includes(
        validation.taskKind ?? "",
      ),
  );
  if (failed.length)
    throw new Error(
      `Current validation is still failing: ${failed.map((item) => item.taskId ?? item.command).join(", ")}. Resolve it and run the relevant check before finishing.`,
    );
}

function latestFailedTasks(
  validations: ReturnType<SessionJournal["currentValidations"]>,
) {
  const latest = new Map(
    validations.map((validation) => [validation.taskId, validation]),
  );
  return new Set(
    [...latest.values()]
      .filter(
        (validation) =>
          validation.taskId &&
          validation.terminal === "failed" &&
          validation.category === "code" &&
          ["build", "test", "typecheck", "lint"].includes(
            validation.taskKind ?? "",
          ),
      )
      .map((validation) => validation.taskId!),
  );
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
