import type { CompletionDecision } from "./completion.js";
import type {
  ClockPort,
  CoreLifecycleEvent,
  LifecycleEventSink,
  ModelRuntimePort,
} from "./ports.js";
import type { ExecutionId } from "./result.js";

export type ExecutionTerminalState = "succeeded" | "failed" | "cancelled";

export type ExecutionLifecycleState =
  | "running"
  | "cancelling"
  | ExecutionTerminalState;

export type ExecutionTerminalReason =
  | "completed"
  | "user"
  | "superseded"
  | "shutdown"
  | "timeout"
  | "max_iterations"
  | "mistake_limit"
  | "model_inactivity_timeout"
  | "runtime_crash"
  | "persistence_failure"
  | "code_failure"
  | "infrastructure";

export type ChildOperation = {
  operation_id: string;
  state: "active" | "completed" | "orphaned";
};

export type ExecutionLifecycleSnapshot = {
  execution_id: ExecutionId;
  state: ExecutionLifecycleState;
  sequence: number;
  children: ChildOperation[];
  stop_requested_at?: string;
  terminal_at?: string;
  terminal_reason?: ExecutionTerminalReason;
  completion?: CompletionDecision;
};

export class ExecutionLifecycle {
  private readonly children = new Map<string, ChildOperation>();
  private readonly clock: ClockPort;
  readonly executionId: ExecutionId;
  private lastBusinessEventSequence = -1;
  private sequence = 0;
  private stateValue: ExecutionLifecycleState = "running";
  private stopRequestedAt?: string;
  private terminalAt?: string;
  private terminalReason?: ExecutionTerminalReason;
  private completion?: CompletionDecision;

  constructor(executionId: ExecutionId, clock: ClockPort = systemClock) {
    this.executionId = executionId;
    this.clock = clock;
  }

  start() {
    return this.snapshot();
  }

  running() {
    return this.snapshot();
  }

  requestStop() {
    if (this.stateValue !== "running") return false;
    this.stopRequestedAt = this.clock.now().toISOString();
    this.transition("cancelling", ["running"]);
    return true;
  }

  terminationPending() {
    return this.stateValue === "cancelling";
  }

  finish(
    state: ExecutionTerminalState,
    reason: ExecutionTerminalReason,
    completion?: CompletionDecision,
  ) {
    if (terminalState(this.stateValue)) return false;
    if (this.stateValue === "running") this.requestStop();
    if (this.stateValue !== "cancelling") return false;
    this.stateValue = state;
    this.sequence += 1;
    this.terminalReason = reason;
    this.terminalAt = this.clock.now().toISOString();
    this.completion = completion;
    return true;
  }

  acceptsBusinessEvent(sequence: number) {
    if (this.stateValue !== "running") return false;
    if (sequence <= this.lastBusinessEventSequence) return false;
    this.lastBusinessEventSequence = sequence;
    return true;
  }

  registerChild(operationId: string) {
    if (this.stateValue !== "running" || this.children.has(operationId))
      return false;
    this.children.set(operationId, {
      operation_id: operationId,
      state: "active",
    });
    return true;
  }

  completeChild(operationId: string) {
    const child = this.children.get(operationId);
    if (!child || child.state !== "active") return false;
    child.state = "completed";
    return true;
  }

  orphanActiveChildren() {
    for (const child of this.children.values()) {
      if (child.state === "active") child.state = "orphaned";
    }
  }

  snapshot(): ExecutionLifecycleSnapshot {
    return {
      execution_id: this.executionId,
      state: this.stateValue,
      sequence: this.sequence,
      children: [...this.children.values()].map((child) => ({ ...child })),
      ...(this.stopRequestedAt
        ? { stop_requested_at: this.stopRequestedAt }
        : {}),
      ...(this.terminalAt ? { terminal_at: this.terminalAt } : {}),
      ...(this.terminalReason ? { terminal_reason: this.terminalReason } : {}),
      ...(this.completion ? { completion: this.completion } : {}),
    };
  }

  event(): CoreLifecycleEvent {
    const snapshot = this.snapshot();
    return {
      execution_id: snapshot.execution_id,
      sequence: snapshot.sequence,
      state: snapshot.state,
      occurred_at: this.clock.now().toISOString(),
      ...(snapshot.terminal_reason ? { reason: snapshot.terminal_reason } : {}),
    };
  }

  private tryTransition(
    next: ExecutionLifecycleState,
    allowed: ExecutionLifecycleState[],
  ) {
    if (!allowed.includes(this.stateValue)) return false;
    this.stateValue = next;
    this.sequence += 1;
    return true;
  }

  private transition(
    next: ExecutionLifecycleState,
    allowed: ExecutionLifecycleState[],
  ) {
    if (this.tryTransition(next, allowed)) return;
    throw new Error(`INVALID_LIFECYCLE_TRANSITION:${this.stateValue}:${next}`);
  }
}

export type TerminalPersistencePort = {
  persist(snapshot: ExecutionLifecycleSnapshot): Promise<void>;
};

export class ExecutionTerminator {
  private readonly runtime: ModelRuntimePort;
  private readonly persistence: TerminalPersistencePort;
  private readonly events: LifecycleEventSink;

  constructor(
    runtime: ModelRuntimePort,
    persistence: TerminalPersistencePort,
    events: LifecycleEventSink,
  ) {
    this.runtime = runtime;
    this.persistence = persistence;
    this.events = events;
  }

  async terminate(input: {
    lifecycle: ExecutionLifecycle;
    state: ExecutionTerminalState;
    reason: ExecutionTerminalReason;
    completion?: CompletionDecision;
  }) {
    if (!input.lifecycle.requestStop()) return input.lifecycle.snapshot();
    const receipt = await this.runtime.requestStop(input.lifecycle.executionId);
    if (receipt.status === "pending")
      return this.persistPending(input.lifecycle);
    input.lifecycle.orphanActiveChildren();
    input.lifecycle.finish(input.state, input.reason, input.completion);
    const snapshot = input.lifecycle.snapshot();
    await this.persistence.persist(snapshot);
    await this.events.publish(input.lifecycle.event());
    return snapshot;
  }

  async confirm(input: {
    lifecycle: ExecutionLifecycle;
    state: ExecutionTerminalState;
    reason: ExecutionTerminalReason;
    completion?: CompletionDecision;
  }) {
    if (input.lifecycle.snapshot().state !== "cancelling")
      return input.lifecycle.snapshot();
    input.lifecycle.orphanActiveChildren();
    input.lifecycle.finish(input.state, input.reason, input.completion);
    const snapshot = input.lifecycle.snapshot();
    await this.persistence.persist(snapshot);
    await this.events.publish(input.lifecycle.event());
    return snapshot;
  }

  private async persistPending(lifecycle: ExecutionLifecycle) {
    lifecycle.terminationPending();
    const snapshot = lifecycle.snapshot();
    await this.persistence.persist(snapshot);
    await this.events.publish(lifecycle.event());
    return snapshot;
  }
}

const systemClock: ClockPort = { now: () => new Date() };

function terminalState(
  state: ExecutionLifecycleState,
): state is ExecutionTerminalState {
  return ["succeeded", "failed", "cancelled"].includes(state);
}
