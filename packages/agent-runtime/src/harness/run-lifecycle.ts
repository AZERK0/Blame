import {
  ExecutionLifecycle,
  completionLifecycleTerminal,
  type CompletionDecision,
  type ExecutionLifecycleState,
  type ExecutionTerminalReason,
  type ExecutionTerminalState,
} from "@blame/harness-core";

export type RunTerminalState =
  | ExecutionTerminalState
  | "max_iterations"
  | "mistake_limit";
export type RunLifecycleState = ExecutionLifecycleState;

export function completionAwareTerminalState(
  requested: RunTerminalState,
  completion: CompletionDecision | undefined,
): RunTerminalState {
  if (requested !== "succeeded" || !completion) return requested;
  return completionLifecycleTerminal(completion);
}

export type RunLifecycleSnapshot = {
  execution_id: string;
  post_stop_events: number;
  post_stop_tokens: number;
  session_id: string;
  state: RunLifecycleState;
  stop_requested_at?: string;
  terminal_at?: string;
  terminal_reason?: ExecutionTerminalReason;
  completion?: CompletionDecision;
  sequence: number;
};

type RunRecord = {
  lifecycle: ExecutionLifecycle;
  postStopEvents: number;
  postStopTokens: number;
  sessionId: string;
};

export class RunLifecycleRegistry {
  private readonly runs = new Map<string, RunRecord>();

  begin(sessionId: string, executionId: string) {
    const current = this.runs.get(sessionId);
    if (current?.lifecycle.executionId === executionId)
      return snapshot(current);
    if (current && !terminalState(current.lifecycle.snapshot().state))
      return snapshot(current);
    const lifecycle = new ExecutionLifecycle(executionId);
    const run = { lifecycle, postStopEvents: 0, postStopTokens: 0, sessionId };
    this.runs.set(sessionId, run);
    return snapshot(run);
  }

  stopping(sessionId: string, executionId: string) {
    return (
      this.current(sessionId, executionId)?.lifecycle.requestStop() ?? false
    );
  }

  terminationPending(sessionId: string, executionId: string) {
    return (
      this.current(sessionId, executionId)?.lifecycle.terminationPending() ??
      false
    );
  }

  finish(
    sessionId: string,
    executionId: string,
    state: RunTerminalState,
    completion?: CompletionDecision,
    reason: ExecutionTerminalReason = terminalReason(state),
  ) {
    const run = this.current(sessionId, executionId);
    if (!run) return false;
    const terminal: ExecutionTerminalState =
      state === "max_iterations" || state === "mistake_limit"
        ? "failed"
        : state;
    return run.lifecycle.finish(terminal, reason, completion);
  }

  accepts(sessionId: string, executionId: string, tokens = 0) {
    const run = this.current(sessionId, executionId);
    if (!run) return false;
    if (run.lifecycle.snapshot().state === "running") return true;
    run.postStopEvents += 1;
    run.postStopTokens += Math.max(0, tokens);
    return false;
  }

  canInvoke(sessionId: string, executionId: string) {
    return (
      this.current(sessionId, executionId)?.lifecycle.snapshot().state ===
      "running"
    );
  }

  state(sessionId: string) {
    const run = this.runs.get(sessionId);
    return run ? snapshot(run) : undefined;
  }

  remove(sessionId: string) {
    this.runs.delete(sessionId);
  }

  private current(sessionId: string, executionId: string) {
    const run = this.runs.get(sessionId);
    return run?.lifecycle.executionId === executionId ? run : undefined;
  }
}

function terminalReason(state: RunTerminalState): ExecutionTerminalReason {
  if (state === "max_iterations") return "max_iterations";
  if (state === "mistake_limit") return "mistake_limit";
  if (state === "cancelled") return "user";
  if (state === "failed") return "code_failure";
  return "completed";
}

function terminalState(value: RunLifecycleState) {
  return ["cancelled", "failed", "succeeded"].includes(value);
}

function snapshot(run: RunRecord): RunLifecycleSnapshot {
  const value = run.lifecycle.snapshot();
  return {
    execution_id: value.execution_id,
    post_stop_events: run.postStopEvents,
    post_stop_tokens: run.postStopTokens,
    session_id: run.sessionId,
    state: value.state,
    sequence: value.sequence,
    ...(value.stop_requested_at
      ? { stop_requested_at: value.stop_requested_at }
      : {}),
    ...(value.terminal_at ? { terminal_at: value.terminal_at } : {}),
    ...(value.terminal_reason
      ? { terminal_reason: value.terminal_reason }
      : {}),
    ...(value.completion ? { completion: value.completion } : {}),
  };
}
