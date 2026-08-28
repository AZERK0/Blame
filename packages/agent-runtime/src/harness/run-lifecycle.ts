export type RunTerminalState =
  | "cancelled"
  | "failed"
  | "max_iterations"
  | "succeeded";

export type RunLifecycleState =
  | "running"
  | "stopping"
  | "termination_pending"
  | RunTerminalState;

export type RunLifecycleSnapshot = {
  execution_id: string;
  post_stop_events: number;
  post_stop_tokens: number;
  session_id: string;
  state: RunLifecycleState;
  stop_requested_at?: string;
  terminal_at?: string;
};

type MutableRunLifecycle = RunLifecycleSnapshot;

export class RunLifecycleRegistry {
  private readonly runs = new Map<string, MutableRunLifecycle>();

  begin(sessionId: string, executionId: string) {
    const current = this.runs.get(sessionId);
    if (current?.execution_id === executionId) return snapshot(current);
    if (current && !terminalState(current.state)) return snapshot(current);
    const run: MutableRunLifecycle = {
      execution_id: executionId,
      post_stop_events: 0,
      post_stop_tokens: 0,
      session_id: sessionId,
      state: "running",
    };
    this.runs.set(sessionId, run);
    return snapshot(run);
  }

  stopping(sessionId: string, executionId: string) {
    const run = this.current(sessionId, executionId);
    if (!run || run.state !== "running") return false;
    run.state = "stopping";
    run.stop_requested_at = new Date().toISOString();
    return true;
  }

  terminationPending(sessionId: string, executionId: string) {
    const run = this.current(sessionId, executionId);
    if (!run || run.state !== "stopping") return false;
    run.state = "termination_pending";
    return true;
  }

  finish(sessionId: string, executionId: string, state: RunTerminalState) {
    const run = this.current(sessionId, executionId);
    if (!run || terminalState(run.state)) return false;
    if (run.state === "running") this.stopping(sessionId, executionId);
    run.state = state;
    run.terminal_at = new Date().toISOString();
    return true;
  }

  accepts(sessionId: string, executionId: string, tokens = 0) {
    const run = this.current(sessionId, executionId);
    if (!run) return false;
    if (run.state !== "running") {
      run.post_stop_events += 1;
      run.post_stop_tokens += Math.max(0, tokens);
    }
    return !terminalState(run.state);
  }

  canInvoke(sessionId: string, executionId: string) {
    return this.current(sessionId, executionId)?.state === "running";
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
    return run?.execution_id === executionId ? run : undefined;
  }
}

function terminalState(value: RunLifecycleState) {
  return ["cancelled", "failed", "max_iterations", "succeeded"].includes(value);
}

function snapshot(value: MutableRunLifecycle): RunLifecycleSnapshot {
  return { ...value };
}
