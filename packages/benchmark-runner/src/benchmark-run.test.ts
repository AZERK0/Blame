import assert from "node:assert/strict";
import test from "node:test";
import type {
  AgentEvent,
  AgentRuntimeEvents,
  StartDevelopmentSessionInput,
} from "@blame/agent-runtime";
import { runBenchmark } from "./benchmark-run.js";
import type {
  BenchmarkConfig,
  BenchmarkEventRecorder,
  BenchmarkRuntime,
} from "./contracts.js";

class MemoryRecorder implements BenchmarkEventRecorder {
  eventCount = 0;
  toolEventCount = 0;
  closed = false;

  record(event: AgentEvent) {
    this.eventCount += 1;
    if (event.type === "tool") this.toolEventCount += 1;
  }

  async close() {
    this.closed = true;
  }
}

test("runs one development session and returns benchmark metrics", async () => {
  const recorder = new MemoryRecorder();
  const inputs: StartDevelopmentSessionInput[] = [];
  let shutdown = false;
  const result = await runBenchmark(benchmarkConfig(), {
    createRecorder: () => recorder,
    createRuntime: (events) =>
      successfulRuntime(events, inputs, () => {
        shutdown = true;
      }),
    now: sequencedClock(),
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.durationMs, 1_000);
  assert.equal(result.usage?.aggregateUsage?.totalInputTokens, 12);
  assert.equal(inputs[0]?.summary, "Fix the task");
  assert.equal(recorder.closed, true);
  assert.equal(shutdown, true);
});

test("aborts a session that reaches the benchmark timeout", async () => {
  let aborted = false;
  const result = await runBenchmark(
    { ...benchmarkConfig(), timeoutMs: 5 },
    {
      createRecorder: () => new MemoryRecorder(),
      createRuntime: () =>
        pendingRuntime(() => {
          aborted = true;
        }),
    },
  );
  assert.equal(result.status, "timed_out");
  assert.equal(aborted, true);
});

function successfulRuntime(
  events: AgentRuntimeEvents,
  inputs: StartDevelopmentSessionInput[],
  shutdown: () => void,
): BenchmarkRuntime {
  return runtimeStub({
    shutdown,
    start(input) {
      inputs.push(input);
      queueMicrotask(() => {
        events.emit({ type: "tool", payload: { phase: "started" } });
        events.emit({ type: "done", payload: { verified: true } });
      });
    },
  });
}

function pendingRuntime(abort: () => void) {
  return runtimeStub({ abort, start: () => undefined });
}

function runtimeStub(callbacks: {
  abort?: () => void;
  shutdown?: () => void;
  start(input: StartDevelopmentSessionInput): void;
}): BenchmarkRuntime {
  return {
    sessions: {
      abort: async () => callbacks.abort?.(),
      startDevelopment: async (input) => {
        callbacks.start(input);
        return { sessionId: "session-1" };
      },
      usage: async () => ({
        aggregateUsage: {
          inputTokens: 12,
          outputTokens: 4,
          totalInputTokens: 12,
          totalOutputTokens: 4,
        },
      }),
    },
    shutdown: async () => callbacks.shutdown?.(),
  };
}

function benchmarkConfig(): BenchmarkConfig {
  return {
    apiToken: "token",
    apiUrl: "https://api.example.test",
    instruction: "Fix the task",
    maxIterations: 64,
    modelId: "model",
    providerId: "provider",
    taskId: "task-1",
    timeoutMs: 1_000,
    workspaceRoot: "/workspace",
  };
}

function sequencedClock() {
  const dates = [
    new Date("2026-01-01T00:00:00Z"),
    new Date("2026-01-01T00:00:01Z"),
  ];
  return () => dates.shift() ?? new Date("2026-01-01T00:00:01Z");
}
