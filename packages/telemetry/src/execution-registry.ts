import type { Context, TimeInput } from "@opentelemetry/api";
import { BlameSpan, BlameTelemetry, type TelemetryOutcome } from "./client.js";
import {
  ATTR_BLAME_EXECUTION_ID,
  ATTR_BLAME_EXECUTION_RECOVERED,
  ATTR_BLAME_EXECUTION_STATUS,
  ATTR_BLAME_STORY_ID,
  ATTR_BLAME_WORKTREE_ID,
} from "./semantic-attributes.js";

const executionCloseDelayMs = 60_000;

export type ExecutionDescriptor = {
  executionId: string;
  storyId?: string;
  worktreeId?: string;
  attributes?: Record<string, unknown>;
};

type ExecutionState = {
  activeComponents: number;
  closeTimer?: NodeJS.Timeout;
  closing: boolean;
  components: Set<ExecutionComponent>;
  descriptor: ExecutionDescriptor;
  durationSeconds?: number;
  lastEndTime?: TimeInput;
  operations: Map<string, OperationState>;
  outcome: TelemetryOutcome;
  recoveredFailure: boolean;
  root: BlameSpan;
};

type OperationState = {
  canceled: boolean;
  nextAttemptId: number;
  unresolvedFailures: Set<number>;
};

type OperationAttempt = {
  attemptId: number;
  operationName: string;
  recoverableFailureIds: number[];
};

export class ExecutionComponent {
  private ended = false;
  readonly span: BlameSpan;
  private readonly finish: (
    outcome: TelemetryOutcome,
    endTime?: TimeInput,
  ) => void;

  constructor(
    span: BlameSpan,
    finish: (outcome: TelemetryOutcome, endTime?: TimeInput) => void,
  ) {
    this.span = span;
    this.finish = finish;
  }

  succeed(endTime?: TimeInput) {
    this.end("succeeded", endTime);
  }

  fail(error: unknown, endTime?: TimeInput) {
    if (this.ended) return;
    this.span.recordError(error);
    this.end("failed", endTime);
  }

  cancel(endTime?: TimeInput) {
    this.end("canceled", endTime);
  }

  private end(outcome: TelemetryOutcome, endTime?: TimeInput) {
    if (this.ended) return;
    this.ended = true;
    this.span.end(outcome, endTime);
    this.finish(outcome, endTime);
  }
}

export class ExecutionRegistry {
  private readonly executions = new Map<string, ExecutionState>();
  private readonly telemetry: BlameTelemetry;

  constructor(telemetry: BlameTelemetry) {
    this.telemetry = telemetry;
  }

  beginComponent(
    descriptor: ExecutionDescriptor,
    name: string,
    attributes: Record<string, unknown> = {},
    parent?: Context,
  ) {
    const executionId = descriptor.executionId;
    const state = this.execution(descriptor);
    clearCloseTimer(state);
    state.activeComponents += 1;
    const attempt = beginOperationAttempt(state, name);
    const span = this.telemetry.startSpan(name, {
      attributes: { ...executionAttributes(state.descriptor), ...attributes },
      parent: parent ?? state.root.context,
    });
    const component = new ExecutionComponent(span, (outcome, endTime) => {
      state.components.delete(component);
      this.finishComponent(executionId, attempt, outcome, endTime);
    });
    state.components.add(component);
    return component;
  }

  close(executionId: string, outcome?: TelemetryOutcome) {
    const state = this.executions.get(executionId);
    if (!state) return;
    if (outcome) updateOutcome(state, outcome);
    this.finishExecution(executionId, state);
  }

  setAttributes(executionId: string, attributes: Record<string, unknown>) {
    const state = this.executions.get(executionId);
    if (!state) return;
    state.descriptor.attributes = {
      ...state.descriptor.attributes,
      ...attributes,
    };
    state.root.setAttributes(attributes);
    for (const component of state.components) {
      component.span.setAttributes(attributes);
    }
  }

  attributes(executionId: string) {
    const attributes = this.executions.get(executionId)?.descriptor.attributes;
    return attributes ? { ...attributes } : undefined;
  }

  shutdown() {
    for (const [executionId, state] of this.executions) {
      if (state.activeComponents > 0) updateOutcome(state, "canceled");
      this.finishExecution(executionId, state);
    }
  }

  private execution(descriptor: ExecutionDescriptor) {
    const existing = this.executions.get(descriptor.executionId);
    if (existing) {
      mergeExecutionDescriptor(existing, descriptor);
      return existing;
    }
    const root = this.telemetry.startSpan("blame.execution", {
      attributes: executionAttributes(descriptor),
    });
    const state = createExecutionState(descriptor, root);
    this.executions.set(descriptor.executionId, state);
    this.telemetry.log(
      "info",
      "blame.execution.started",
      executionAttributes(descriptor),
      root.context,
    );
    return state;
  }

  private finishComponent(
    executionId: string,
    attempt: OperationAttempt,
    outcome: TelemetryOutcome,
    endTime?: TimeInput,
  ) {
    const state = this.executions.get(executionId);
    if (!state || state.closing) return;
    state.activeComponents = Math.max(0, state.activeComponents - 1);
    state.lastEndTime = endTime ?? Date.now();
    state.durationSeconds = state.root.durationSeconds();
    finishOperationAttempt(state, attempt, outcome);
    if (state.activeComponents === 0) this.scheduleClose(executionId, state);
  }

  private scheduleClose(executionId: string, state: ExecutionState) {
    state.closeTimer = setTimeout(() => {
      this.finishExecution(executionId, state);
    }, executionCloseDelayMs);
    state.closeTimer.unref();
  }

  private finishExecution(executionId: string, state: ExecutionState) {
    if (state.closing || this.executions.get(executionId) !== state) return;
    state.closing = true;
    clearCloseTimer(state);
    const hadActiveComponents = state.activeComponents > 0;
    const endTime = executionEndTime(state);
    if (hadActiveComponents) {
      updateOutcome(state, "canceled");
      state.durationSeconds = state.root.durationSeconds();
    }
    finishActiveComponents(state, endTime);
    this.executions.delete(executionId);
    const attributes = completionAttributes(state);
    state.root.setAttributes(attributes);
    this.recordExecutionMetrics(state, attributes);
    this.telemetry.log(
      "info",
      "blame.execution.completed",
      attributes,
      state.root.context,
    );
    state.root.end(state.outcome, endTime);
  }

  private recordExecutionMetrics(
    state: ExecutionState,
    attributes: Record<string, unknown>,
  ) {
    this.telemetry.count(
      "blame.execution.count",
      1,
      attributes,
      state.root.context,
    );
    this.telemetry.record(
      "blame.execution.duration",
      state.durationSeconds ?? state.root.durationSeconds(),
      attributes,
      state.root.context,
    );
    if (state.recoveredFailure && state.outcome === "succeeded") {
      this.telemetry.count(
        "blame.execution.recovery.count",
        1,
        attributes,
        state.root.context,
      );
    }
  }
}

function createExecutionState(
  descriptor: ExecutionDescriptor,
  root: BlameSpan,
): ExecutionState {
  return {
    activeComponents: 0,
    closing: false,
    components: new Set(),
    descriptor: {
      ...descriptor,
      attributes: descriptor.attributes
        ? { ...descriptor.attributes }
        : undefined,
    },
    operations: new Map(),
    outcome: "succeeded",
    recoveredFailure: false,
    root,
  };
}

function executionEndTime(state: ExecutionState) {
  if (state.activeComponents > 0) return Date.now();
  return state.lastEndTime ?? Date.now();
}

function finishActiveComponents(state: ExecutionState, endTime: TimeInput) {
  for (const component of [...state.components]) component.cancel(endTime);
  state.activeComponents = 0;
  state.components.clear();
}

function completionAttributes(state: ExecutionState) {
  return {
    ...executionAttributes(state.descriptor),
    [ATTR_BLAME_EXECUTION_RECOVERED]:
      state.recoveredFailure && state.outcome === "succeeded",
    [ATTR_BLAME_EXECUTION_STATUS]: state.outcome,
  };
}

function executionAttributes(descriptor: ExecutionDescriptor) {
  return {
    ...descriptor.attributes,
    [ATTR_BLAME_EXECUTION_ID]: descriptor.executionId,
    [ATTR_BLAME_STORY_ID]: descriptor.storyId,
    [ATTR_BLAME_WORKTREE_ID]: descriptor.worktreeId,
  };
}

function updateOutcome(state: ExecutionState, outcome: TelemetryOutcome) {
  if (outcome === "failed") state.outcome = "failed";
  if (outcome === "canceled" && state.outcome !== "failed") {
    state.outcome = "canceled";
  }
}

function beginOperationAttempt(
  state: ExecutionState,
  operationName: string,
): OperationAttempt {
  const operation = operationState(state, operationName);
  const attemptId = operation.nextAttemptId;
  operation.nextAttemptId += 1;
  return {
    attemptId,
    operationName,
    recoverableFailureIds: [...operation.unresolvedFailures],
  };
}

function finishOperationAttempt(
  state: ExecutionState,
  attempt: OperationAttempt,
  outcome: TelemetryOutcome,
) {
  const operation = operationState(state, attempt.operationName);
  if (outcome === "failed") operation.unresolvedFailures.add(attempt.attemptId);
  if (outcome === "succeeded") recoverFailures(state, operation, attempt);
  if (outcome === "canceled") operation.canceled = true;
  state.outcome = aggregateOperationOutcome(state.operations.values());
}

function recoverFailures(
  state: ExecutionState,
  operation: OperationState,
  attempt: OperationAttempt,
) {
  for (const failureId of attempt.recoverableFailureIds) {
    if (operation.unresolvedFailures.delete(failureId)) {
      state.recoveredFailure = true;
    }
  }
}

function aggregateOperationOutcome(operations: Iterable<OperationState>) {
  const operationStates = [...operations];
  if (operationStates.some(hasUnresolvedFailures)) return "failed";
  if (operationStates.some(({ canceled }) => canceled)) return "canceled";
  return "succeeded";
}

function hasUnresolvedFailures(operation: OperationState) {
  return operation.unresolvedFailures.size > 0;
}

function operationState(state: ExecutionState, operationName: string) {
  const existing = state.operations.get(operationName);
  if (existing) return existing;
  const operation = createOperationState();
  state.operations.set(operationName, operation);
  return operation;
}

function createOperationState(): OperationState {
  return {
    canceled: false,
    nextAttemptId: 1,
    unresolvedFailures: new Set(),
  };
}

function mergeExecutionDescriptor(
  state: ExecutionState,
  descriptor: ExecutionDescriptor,
) {
  state.descriptor = {
    ...state.descriptor,
    ...(descriptor.storyId ? { storyId: descriptor.storyId } : {}),
    ...(descriptor.worktreeId ? { worktreeId: descriptor.worktreeId } : {}),
    attributes: {
      ...state.descriptor.attributes,
      ...descriptor.attributes,
    },
  };
  state.root.setAttributes(executionAttributes(state.descriptor));
}

function clearCloseTimer(state: ExecutionState) {
  if (!state.closeTimer) return;
  clearTimeout(state.closeTimer);
  state.closeTimer = undefined;
}
