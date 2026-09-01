import { BlameAgentRuntime, type AgentEvent } from "@blame/agent-runtime";
import type {
  BenchmarkConfig,
  BenchmarkEventRecorder,
  BenchmarkResult,
  BenchmarkRunDependencies,
  BenchmarkRuntime,
  BenchmarkSessionInput,
} from "./contracts.js";

class BenchmarkTimeoutError extends Error {}
class BenchmarkCancelledError extends Error {}

export async function runBenchmark(
  config: BenchmarkConfig,
  dependencies: BenchmarkRunDependencies,
): Promise<BenchmarkResult> {
  const startedAt = (dependencies.now ?? currentDate)();
  const recorder = dependencies.createRecorder();
  const terminal = terminalObserver(recorder);
  const runtime = dependencies.createRuntime(terminal.events);
  let outcome;
  try {
    outcome = await executeSession(
      config,
      runtime,
      terminal.promise,
      dependencies.signal,
    );
  } finally {
    await runtime.shutdown().catch(() => undefined);
    await recorder.close();
  }
  const finishedAt = (dependencies.now ?? currentDate)();
  return benchmarkResult({
    config,
    finishedAt,
    recorder,
    startedAt,
    ...outcome,
  });
}

async function executeSession(
  config: BenchmarkConfig,
  runtime: BenchmarkRuntime,
  terminal: Promise<AgentEvent>,
  signal?: AbortSignal,
) {
  let sessionId: string | undefined;
  let usage;
  let terminalEvent: AgentEvent | undefined;
  let failure: unknown;
  try {
    sessionId = (await runtime.sessions.startDevelopment(sessionInput(config)))
      .sessionId;
    terminalEvent = await waitForTerminal(terminal, config.timeoutMs, signal);
    usage = await runtime.sessions.usage(sessionId).catch(() => undefined);
  } catch (error) {
    failure = error;
    await abortSession(runtime, sessionId);
  }
  return { failure, sessionId, terminalEvent, usage };
}

export function runtimeFactory(events: { emit(event: AgentEvent): void }) {
  return new BlameAgentRuntime(events);
}

function sessionInput(config: BenchmarkConfig): BenchmarkSessionInput {
  return {
    apiConnection: { token: config.apiToken, url: config.apiUrl },
    credentialLabel: config.credentialLabel,
    cwd: config.workspaceRoot,
    maxIterations: config.maxIterations,
    modelId: config.modelId,
    providerId: config.providerId,
    reasoningEffort: config.reasoningEffort,
    summary: config.instruction,
    title: config.taskId,
    workspaceRoot: config.workspaceRoot,
  };
}

function terminalObserver(recorder: BenchmarkEventRecorder) {
  let resolveTerminal: (event: AgentEvent) => void = () => undefined;
  const promise = new Promise<AgentEvent>((resolve) => {
    resolveTerminal = resolve;
  });
  return {
    events: {
      emit(event: AgentEvent) {
        recorder.record(event);
        if (event.type === "done" || event.type === "error")
          resolveTerminal(event);
      },
    },
    promise,
  };
}

function waitForTerminal(
  terminal: Promise<AgentEvent>,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  return new Promise<AgentEvent>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      return true;
    };
    const resolveOnce = (event: AgentEvent) => {
      if (finish()) resolve(event);
    };
    const rejectOnce = (error: unknown) => {
      if (finish()) reject(error);
    };
    const timer = setTimeout(
      () => rejectOnce(new BenchmarkTimeoutError("Benchmark timed out.")),
      timeoutMs,
    );
    const cancel = () =>
      rejectOnce(new BenchmarkCancelledError("Benchmark cancelled."));
    if (signal?.aborted) return cancel();
    signal?.addEventListener("abort", cancel, { once: true });
    terminal.then(resolveOnce, rejectOnce);
  });
}

async function abortSession(runtime: BenchmarkRuntime, sessionId?: string) {
  if (!sessionId) return;
  await runtime.sessions.abort(sessionId).catch(() => undefined);
}

function benchmarkResult(input: {
  config: BenchmarkConfig;
  failure?: unknown;
  finishedAt: Date;
  recorder: BenchmarkEventRecorder;
  sessionId?: string;
  startedAt: Date;
  terminalEvent?: AgentEvent;
  usage?: BenchmarkResult["usage"];
}): BenchmarkResult {
  const terminalPayload = recordValue(input.terminalEvent?.payload);
  return {
    completion: terminalPayload?.completion,
    durationMs: input.finishedAt.getTime() - input.startedAt.getTime(),
    error: resultError(input.failure, input.terminalEvent),
    eventCount: input.recorder.eventCount,
    finishedAt: input.finishedAt.toISOString(),
    modelId: input.config.modelId,
    providerId: input.config.providerId,
    schemaVersion: 1,
    sessionId: input.sessionId,
    startedAt: input.startedAt.toISOString(),
    status: resultStatus(input.failure, input.terminalEvent),
    taskId: input.config.taskId,
    toolEventCount: input.recorder.toolEventCount,
    usage: input.usage,
    verified: booleanValue(terminalPayload?.verified),
  };
}

function resultStatus(failure: unknown, terminal?: AgentEvent) {
  if (failure instanceof BenchmarkTimeoutError) return "timed_out" as const;
  if (failure instanceof BenchmarkCancelledError) return "cancelled" as const;
  if (failure || terminal?.type === "error") return "failed" as const;
  return "succeeded" as const;
}

function resultError(failure: unknown, terminal?: AgentEvent) {
  if (failure) return errorMessage(failure);
  if (terminal?.type !== "error") return undefined;
  return String(
    recordValue(terminal.payload)?.message ?? "Agent session failed.",
  );
}

function recordValue(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function currentDate() {
  return new Date();
}
