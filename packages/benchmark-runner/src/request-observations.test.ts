import assert from "node:assert/strict";
import test from "node:test";
import type { AgentEvent } from "@blame/agent-runtime";
const { BenchmarkMetricsCollector } = await import(process.env.BLAME_METRICS_RUNTIME ?? "./benchmark-metrics.js") as typeof import("./benchmark-metrics.js");
const event = (type: AgentEvent["type"], payload: Record<string, unknown>) => ({ type, payload }) as AgentEvent;
const usage = (value: Record<string, unknown>) => event("usage", { usage: value });
function context(events: AgentEvent[]) {
  const collector = new BenchmarkMetricsCollector();
  for (const value of events) collector.record(value);
  // Exercise the serialized benchmark API, including explicit JSON nulls.
  return JSON.parse(JSON.stringify(collector.summary(new Date(0), new Date(1000)).context)) as {
    modelRequests: number | null; averageInputTokens: number | null; maximumInputTokens: number | null;
    requestObservations?: { schemaVersion: string; coverage: string; iterationStartEvents: number;
      usageReportEvents: number; inputTokenReportEvents: number; transportAttempts: number | null; completedResponses: number | null };
  };
}
const observation = (iterations: number, reports: number, inputs: number) => ({
  schemaVersion: "request-observations-v1", coverage: "agent_events_only", iterationStartEvents: iterations,
  usageReportEvents: reports, inputTokenReportEvents: inputs, transportAttempts: null, completedResponses: null,
});
test("a stalled iteration is observed without inventing zero transport attempts", () => {
  const result = context([event("notice", { message: "Agent iteration started." })]);
  assert.equal(result.modelRequests, null); assert.equal(result.averageInputTokens, null);
  assert.equal(result.maximumInputTokens, null); assert.deepEqual(result.requestObservations, observation(1, 0, 0));
});
test("output-only usage is a report, not an input-token sample or transport receipt", () => {
  const result = context([usage({ outputTokens: 20 })]);
  assert.equal(result.modelRequests, null); assert.equal(result.averageInputTokens, null);
  assert.deepEqual(result.requestObservations, observation(0, 1, 0));
});
test("iteration starts and input-bearing reports retain different counts", () => {
  const result = context([event("notice", { message: "Agent iteration started." }), usage({ inputTokens: 123 }),
    event("notice", { message: "Agent iteration started." })]);
  assert.equal(result.modelRequests, null); assert.equal(result.averageInputTokens, 123);
  assert.deepEqual(result.requestObservations, observation(2, 1, 1));
});
test("an observed zero input remains known zero", () => {
  const result = context([usage({ inputTokens: 0 })]);
  assert.equal(result.averageInputTokens, 0); assert.equal(result.maximumInputTokens, 0);
  assert.equal(result.modelRequests, null); assert.deepEqual(result.requestObservations, observation(0, 1, 1));
});
test("negative or nonfinite inputs do not become usage samples", () => {
  const result = context([usage({ inputTokens: -2 }), usage({ inputTokens: Infinity }), usage({ inputTokens: NaN })]);
  assert.equal(result.averageInputTokens, null); assert.equal(result.maximumInputTokens, null);
  assert.deepEqual(result.requestObservations, observation(0, 3, 0));
});
test("empty streams explicitly leave request count and input statistics unknown", () => {
  const result = context([]);
  assert.equal(result.modelRequests, null); assert.equal(result.averageInputTokens, null); assert.equal(result.maximumInputTokens, null);
  assert.deepEqual(result.requestObservations, observation(0, 0, 0));
});
test("cumulative-only counters are never counted as per-request input samples", () => {
  const result = context([usage({ totalInputTokens: 999 })]);
  assert.equal(result.averageInputTokens, null); assert.deepEqual(result.requestObservations, observation(0, 1, 0));
});
test("composition and command output are not transport or iteration-start evidence", () => {
  const result = context([event("notice", { kind: "context_composed", metrics: { requestIndex: 1, composedBytes: 100 } }),
    event("tool", { phase: "finished", tool: "run_task", output: { text: "Agent iteration started." } })]);
  assert.equal(result.modelRequests, null); assert.deepEqual(result.requestObservations, observation(0, 0, 0));
});
