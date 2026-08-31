import assert from "node:assert/strict";
import test from "node:test";
import { metrics, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import type { CoreSessionEvent } from "@cline/sdk";
import { getExecutionRegistry } from "@blame/telemetry";
import {
  AgentTelemetry,
  boundedInterventionType,
  boundedCohortName,
  boundedToolName,
  commandCategory,
  coreEventDetails,
  isRetryEvent,
  nextExecutionDescriptor,
  providerErrorType,
  providerAuthType,
  repositoryLanguage,
  repositorySizeBucket,
  responseAttributes,
  toolFailed,
  usageDelta,
  usageSnapshot,
} from "./agent-telemetry.js";
import { qualityFromStatus, qualityFromStatusDelta } from "./cline-runtime.js";
import { taskComplexityBucket } from "./telemetry-cohorts.js";

type CapturedSpan = ReturnType<
  InMemorySpanExporter["getFinishedSpans"]
>[number];

test("records usage totals as monotonic deltas", () => {
  const first = usageSnapshot({
    aggregateUsage: {
      totalCacheReadTokens: 20,
      totalCacheWriteTokens: 5,
      totalCost: 0.04,
      totalInputTokens: 100,
      totalOutputTokens: 40,
    },
  });
  const second = usageSnapshot({
    usage: {
      totalCacheReadTokens: 30,
      totalCacheWriteTokens: 8,
      totalCost: 0.07,
      totalInputTokens: 160,
      totalOutputTokens: 55,
    },
  });
  assert.deepEqual(usageDelta(first, second), {
    cacheCreated: 3,
    cacheRead: 10,
    cost: 0.030000000000000006,
    input: 60,
    output: 15,
  });
});

test("treats reset totals as a new accumulation window", () => {
  assert.deepEqual(
    usageDelta(
      {
        cacheCreated: 10,
        cacheRead: 30,
        cost: 0.5,
        input: 300,
        output: 100,
      },
      {
        cacheCreated: 2,
        cacheRead: 5,
        cost: 0.1,
        input: 50,
        output: 20,
      },
    ),
    {
      cacheCreated: 2,
      cacheRead: 5,
      cost: 0.1,
      input: 50,
      output: 20,
    },
  );
});

test("derives quality counts without retaining file paths", () => {
  assert.deepEqual(
    qualityFromStatus(
      [
        " M src/existing.ts",
        "?? src/new-feature.test.ts",
        "A  tests/integration/new-flow.ts",
      ].join("\n"),
    ),
    { filesModified: 3, testsAdded: 2 },
  );
});

test("accepts a trimmed leading porcelain status", () => {
  assert.deepEqual(qualityFromStatus("M src/existing.ts"), {
    filesModified: 1,
    testsAdded: 0,
  });
});

test("excludes files already modified before the agent turn", () => {
  const baseline = [" M src/existing.ts", "?? tests/preexisting.test.ts"].join(
    "\n",
  );
  const status = [
    "M  src/existing.ts",
    "A  tests/preexisting.test.ts",
    " M src/agent-change.ts",
    "?? tests/agent-change.test.ts",
  ].join("\n");
  assert.deepEqual(qualityFromStatusDelta(baseline, status), {
    filesModified: 2,
    testsAdded: 1,
  });
});

test("replaces execution descriptors without mutating prior traces", () => {
  const previous = { executionId: "execution-1", storyId: "story-1" };
  const next = nextExecutionDescriptor(previous, "execution-2", "story-2");
  assert.deepEqual(previous, {
    executionId: "execution-1",
    storyId: "story-1",
  });
  assert.deepEqual(next, {
    executionId: "execution-2",
    storyId: "story-2",
  });
});

test("keeps parallel teammate identities distinct", () => {
  assert.equal(coreEventDetails(teammateEvent("agent-1")).agentKey, "agent-1");
  assert.equal(coreEventDetails(teammateEvent("agent-2")).agentKey, "agent-2");
});

test("recognizes Cline tool error payloads", () => {
  assert.equal(toolFailed({ error: "command failed" }), true);
  assert.equal(toolFailed({ status: "completed" }), false);
});

test("recognizes provider recovery notices as retries", () => {
  assert.equal(isRetryEvent({ noticeType: "recovery", type: "notice" }), true);
  assert.equal(isRetryEvent({ reason: "invalid_tool_call" }), true);
  assert.equal(isRetryEvent({ type: "content_start" }), false);
});

test("records stable GenAI finish reasons", () => {
  assert.deepEqual(responseAttributes({}, "succeeded"), {
    "gen_ai.response.finish_reasons": ["stop"],
    "gen_ai.response.model": undefined,
  });
  assert.deepEqual(responseAttributes({ finishReason: "tool-calls" }), {
    "gen_ai.response.finish_reasons": ["tool-calls"],
    "gen_ai.response.model": undefined,
  });
  assert.deepEqual(responseAttributes({ finishReason: "max_iterations" }), {
    "gen_ai.response.finish_reasons": ["max-iterations"],
    "gen_ai.response.model": undefined,
  });
  assert.deepEqual(responseAttributes({}, "failed"), {
    "gen_ai.response.finish_reasons": ["error"],
    "gen_ai.response.model": undefined,
  });
  assert.deepEqual(
    responseAttributes({ finishReason: "private model output" }),
    {
      "gen_ai.response.finish_reasons": ["other"],
      "gen_ai.response.model": undefined,
    },
  );
  assertResponseModelAttributes();
});

function assertResponseModelAttributes() {
  assert.equal(
    responseAttributes({ responseModel: "https://private.test/model" })[
      "gen_ai.response.model"
    ],
    "other",
  );
  assert.equal(
    responseAttributes({ responseModel: "gpt-response" })[
      "gen_ai.response.model"
    ],
    "gpt-response",
  );
}

test("bounds repository and task cohort values", () => {
  assert.equal(boundedCohortName("openai/gpt-test"), "openai/gpt-test");
  assert.equal(boundedCohortName("https://private.example/model"), "other");
  assert.equal(boundedCohortName("sk-abcdefghijklmnop"), "other");
  assert.equal(boundedToolName("mcp/search-code"), "mcp/search-code");
  assert.equal(boundedToolName("private tool arguments"), "other");
  assert.equal(boundedToolName("sk-abcdefghijklmnop"), "other");
  assert.equal(repositoryLanguage(["TSX", "TypeScript"]), "typescript");
  assert.equal(repositoryLanguage(["TypeScript", "Python"]), "mixed");
  assert.equal(repositoryLanguage(["private-custom-language"]), "other");
  assert.equal(repositorySizeBucket(99), "small");
  assert.equal(repositorySizeBucket(1_000), "large");
  assert.equal(repositorySizeBucket(10_000), "very_large");
  assert.equal(taskComplexityBucket(400, 0), "small");
  assert.equal(taskComplexityBucket(2_000, 2), "medium");
  assert.equal(taskComplexityBucket(8_000, 0), "large");
  assert.equal(boundedInterventionType("tool_approval"), "tool_approval");
  assert.equal(boundedInterventionType("private intervention"), "other");
  assert.equal(providerAuthType("oauth"), "oauth");
  assert.equal(providerAuthType("private auth"), "other");
});

test("classifies shell families without retaining command arguments", () => {
  assert.equal(
    commandCategory("run_commands", { command: "git status" }),
    "git",
  );
  assert.equal(
    commandCategory("run_commands", { command: "pnpm install --token secret" }),
    "install",
  );
  assert.equal(
    commandCategory("run_commands", { command: "pnpm test" }),
    "test",
  );
  assert.equal(commandCategory("read_files", { path: "/private" }), undefined);
});

test("counts only provider-class failures as provider errors", () => {
  assert.equal(providerErrorType({ reason: "api_error" }), "ProviderApiError");
  assert.equal(
    providerErrorType(new Error("Request timed out")),
    "ProviderTimeoutError",
  );
  assert.equal(providerErrorType({ reason: "invalid_tool_call" }), undefined);
  assert.equal(
    providerErrorType({ reason: "tool_execution_failed" }),
    undefined,
  );
});

test("emits correlated private-safe agent telemetry", async () => {
  const capture = installTelemetryCapture();
  try {
    runCapturedAgentExecution();
    getExecutionRegistry().close("execution-integration");
    await flushTelemetryCapture(capture);
    const traceId = assertCapturedSpanHierarchy(
      capture.spanExporter.getFinishedSpans(),
    );
    assertCapturedMetrics(capture.metricExporter);
    assertCapturedLogs(capture.logExporter.getFinishedLogRecords(), traceId);
    const agent = new AgentTelemetry();
    await runDetachedTelemetry(agent);
    getExecutionRegistry().shutdown();
    await flushTelemetryCapture(capture);
    assertDetachedSemantics(capture);
  } finally {
    await shutdownTelemetryCapture(capture);
  }
});

async function runDetachedTelemetry(agent: AgentTelemetry) {
  agent.recordOperationRetry(
    { modelId: "sk-abcdefghijklmnop", providerId: "openai-codex" },
    "title_generation",
    new Error("private retry failure"),
  );
  await agent.runOperation(
    { modelId: "requested-model", providerId: "openai" },
    "commit_message",
    async () => ({ model: "response-model" }),
  );
  await assert.rejects(
    agent.runOperation(
      { modelId: "failed-model", providerId: "openai" },
      "title_generation",
      async () => {
        throw new Error("private provider failure");
      },
    ),
  );
  await runNestedBusinessTelemetry(agent);
}

async function runNestedBusinessTelemetry(agent: AgentTelemetry) {
  const input = { modelId: "nested-model", providerId: "openai-codex" };
  await agent.runBusinessOperation(input, "project_initialization", () =>
    runNestedAttempts(agent, input),
  );
}

async function runNestedAttempts(
  agent: AgentTelemetry,
  input: { modelId: string; providerId: string },
) {
  await assert.rejects(
    agent.runOperation(input, "project_initialization", async () => {
      throw new Error("private retry failure");
    }),
  );
  return agent.runOperation(input, "project_initialization", async () => ({
    model: "nested-response-model",
  }));
}

function assertDetachedSemantics(
  capture: ReturnType<typeof installTelemetryCapture>,
) {
  const spans = capture.spanExporter.getFinishedSpans();
  const agent = spans.find(
    (span) =>
      span.name === "invoke_agent" &&
      span.attributes["blame.operation.name"] === "commit_message",
  );
  assert.ok(agent);
  const model = requiredSpan(spans, "chat requested-model");
  assert.equal(agent.attributes["gen_ai.operation.name"], "invoke_agent");
  assert.equal(model.attributes["gen_ai.operation.name"], "chat");
  assert.equal(model.attributes["gen_ai.response.model"], "response-model");
  assertDetachedFailure(spans);
  assertNestedBusinessSemantics(spans);
  assertModelMetricResponse(capture.metricExporter);
  assertRetryMetricDimensions(capture.metricExporter);
}

function assertRetryMetricDimensions(exporter: InMemoryMetricExporter) {
  const metric = exporter
    .getMetrics()
    .flatMap((resource) => resource.scopeMetrics)
    .flatMap((scope) => scope.metrics)
    .find(
      (candidate) => candidate.descriptor.name === "blame.agent.retry.count",
    );
  assert.ok(metric);
  assert.ok(
    metric.dataPoints.some(
      (point) =>
        point.attributes["gen_ai.provider.name"] === "openai" &&
        point.attributes["gen_ai.request.model"] === "other",
    ),
  );
}

function assertDetachedFailure(spans: CapturedSpan[]) {
  const model = requiredSpan(spans, "chat failed-model");
  assert.equal(model.attributes["blame.operation.status"], "failed");
  assert.equal(model.attributes["error.type"], "ModelError");
  assert.deepEqual(model.attributes["gen_ai.response.finish_reasons"], [
    "error",
  ]);
}

function assertNestedBusinessSemantics(spans: CapturedSpan[]) {
  const business = requiredSpan(spans, "blame.project_initialization");
  const executionId = business.attributes["blame.execution.id"];
  const modelAgent = spans.find(
    (span) =>
      span.name === "invoke_agent" &&
      span.attributes["blame.operation.name"] === "project_initialization",
  );
  assert.ok(modelAgent);
  assert.equal(modelAgent.attributes["blame.execution.id"], executionId);
  assert.equal(modelAgent.attributes["gen_ai.provider.name"], "openai");
  assert.equal(
    modelAgent.parentSpanContext?.spanId,
    business.spanContext().spanId,
  );
  const modelAgents = spans.filter(
    (span) =>
      span.name === "invoke_agent" &&
      span.attributes["blame.operation.name"] === "project_initialization",
  );
  assert.equal(modelAgents.length, 2);
  const roots = spans.filter(
    (span) =>
      span.name === "blame.execution" &&
      span.attributes["blame.execution.id"] === executionId,
  );
  assert.equal(roots.length, 1);
  assert.equal(roots[0]?.attributes["blame.execution.recovered"], true);
  assert.equal(roots[0]?.attributes["blame.execution.status"], "succeeded");
}

function assertModelMetricResponse(exporter: InMemoryMetricExporter) {
  const metrics = exporter
    .getMetrics()
    .flatMap((resource) => resource.scopeMetrics)
    .flatMap((scope) => scope.metrics)
    .filter(
      (candidate) => candidate.descriptor.name === "blame.model.request.count",
    );
  assert.ok(
    metrics.some((metric) =>
      metric.dataPoints.some(
        (point) =>
          point.attributes["gen_ai.response.model"] === "response-model",
      ),
    ),
  );
  assert.ok(
    metrics.some((metric) =>
      metric.dataPoints.some(
        (point) =>
          point.attributes["blame.operation.status"] === "failed" &&
          point.attributes["error.type"] === "ModelError",
      ),
    ),
  );
}

function runCapturedAgentExecution() {
  const agent = new AgentTelemetry();
  startCapturedAgentExecution(agent);
  completeCapturedAgentExecution(agent);
}

function startCapturedAgentExecution(agent: AgentTelemetry) {
  agent.start("session-integration", {
    enableSpawnAgent: true,
    executionId: "execution-integration",
    modelId: "gpt-test",
    providerId: "openai",
    storyId: "story-integration",
  });
  agent.setAuthentication("session-integration", "oauth");
  agent.startModelRequest("session-integration");
  agent.observeCoreEvent("session-integration", iterationEvent("lead", 1));
  agent.observeCoreEvent("session-integration", usageEvent("lead", 100));
  observeCapturedTeammate(agent);
  observeCapturedTestTool(agent);
  observeCapturedNavigationTools(agent);
  agent.startModelRequest("session-integration");
}

function observeCapturedTeammate(agent: AgentTelemetry) {
  agent.observeCoreEvent(
    "session-integration",
    toolEvent("content_start", "spawn_agent", "spawn-1"),
  );
  agent.observeCoreEvent("session-integration", iterationEvent("agent-1", 1));
  agent.observeCoreEvent("session-integration", usageEvent("agent-1", 20));
  agent.observeCoreEvent(
    "session-integration",
    toolEvent("content_start", "read_files", "team-tool", "agent-1"),
  );
  agent.observeCoreEvent(
    "session-integration",
    toolEvent("content_end", "read_files", "team-tool", "agent-1"),
  );
  agent.observeCoreEvent(
    "session-integration",
    toolEvent("content_end", "spawn_agent", "spawn-1"),
  );
}

function observeCapturedTestTool(agent: AgentTelemetry) {
  agent.observeCoreEvent(
    "session-integration",
    toolEvent("content_start", "run_commands", "tool-1"),
  );
  agent.observeCoreEvent(
    "session-integration",
    toolEvent("content_end", "run_commands", "tool-1"),
  );
}

function observeCapturedNavigationTools(agent: AgentTelemetry) {
  observeCompletedTool(agent, "read_code", "navigation-symbol", {
    body: "return project",
    signature: "function project()",
    view: "symbol",
  });
  observeCompletedTool(agent, "read_code", "navigation-covered", {
    status: "already_in_context",
    view: "raw",
  });
}

function observeCompletedTool(
  agent: AgentTelemetry,
  name: string,
  id: string,
  data: Record<string, unknown>,
) {
  agent.observeCoreEvent(
    "session-integration",
    toolEvent("content_start", name, id),
  );
  agent.observeCoreEvent(
    "session-integration",
    toolEvent("content_end", name, id, "lead", { data }),
  );
}

function completeCapturedAgentExecution(agent: AgentTelemetry) {
  agent.recordUsageSummary("session-integration", {
    aggregateUsage: usageTotals(150),
  });
  agent.completeModelRequest("session-integration", {
    finishReason: "private model response",
    responseModel: "gpt-response",
  });
  agent.recordQuality("session-integration", {
    filesModified: 2,
    testsAdded: 1,
  });
  agent.observeEvent("session-integration", {
    type: "done",
    payload: {
      finishReason: "private model response",
      responseModel: "gpt-response",
    },
  });
}

function iterationEvent(agentId: string, iteration: number) {
  return coreAgentEvent(agentId, { iteration, type: "iteration_start" });
}

function usageEvent(agentId: string, totalInputTokens: number) {
  return coreAgentEvent(agentId, {
    totalInputTokens,
    totalOutputTokens: 0,
    type: "usage",
  });
}

function toolEvent(
  type: "content_start" | "content_end",
  toolName: string,
  id: string,
  agentId = "lead",
  output?: Record<string, unknown>,
) {
  return coreAgentEvent(agentId, {
    contentType: "tool",
    toolCall: {
      id,
      input:
        toolName === "run_commands"
          ? { command: "pnpm test --token private-secret" }
          : { role: "reviewer" },
    },
    toolName,
    type,
    ...(output ? { output } : {}),
  });
}

function coreAgentEvent(agentId: string, event: Record<string, unknown>) {
  return {
    payload: {
      event,
      sessionId: "session-integration",
      ...(agentId === "lead"
        ? {}
        : { teamAgentId: agentId, teamRole: "teammate" }),
    },
    type: "agent_event",
  } as CoreSessionEvent;
}

function usageTotals(totalInputTokens: number) {
  return {
    inputTokens: totalInputTokens,
    outputTokens: 0,
    totalInputTokens,
    totalOutputTokens: 0,
  };
}

function installTelemetryCapture() {
  const spanExporter = new InMemorySpanExporter();
  const spanProvider = new TracerProvider({
    spanProcessors: [new SimpleSpanProcessor({ exporter: spanExporter })],
  });
  trace.setGlobalTracerProvider(spanProvider);
  const metricExporter = new InMemoryMetricExporter(
    AggregationTemporality.CUMULATIVE,
  );
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 60_000,
  });
  const meterProvider = new MeterProvider({ readers: [metricReader] });
  metrics.setGlobalMeterProvider(meterProvider);
  const logExporter = new InMemoryLogRecordExporter();
  const loggerProvider = new LoggerProvider({
    processors: [new SimpleLogRecordProcessor({ exporter: logExporter })],
  });
  logs.setGlobalLoggerProvider(loggerProvider);
  return {
    logExporter,
    loggerProvider,
    meterProvider,
    metricExporter,
    spanExporter,
    spanProvider,
  };
}

async function flushTelemetryCapture(
  capture: ReturnType<typeof installTelemetryCapture>,
) {
  await Promise.all([
    capture.loggerProvider.forceFlush(),
    capture.meterProvider.forceFlush(),
    capture.spanProvider.forceFlush(),
  ]);
}

async function shutdownTelemetryCapture(
  capture: ReturnType<typeof installTelemetryCapture>,
) {
  await Promise.all([
    capture.loggerProvider.shutdown(),
    capture.meterProvider.shutdown(),
    capture.spanProvider.shutdown(),
  ]);
  logs.disable();
  metrics.disable();
  trace.disable();
}

function assertCapturedSpanHierarchy(
  spans: ReturnType<InMemorySpanExporter["getFinishedSpans"]>,
) {
  const root = requiredSpan(spans, "blame.execution");
  const agent = requiredAgentSpan(spans, "lead");
  const model = spans.find(
    (span) =>
      span.name === "chat gpt-test" &&
      span.attributes["gen_ai.response.model"] === "gpt-response",
  );
  assert.ok(model);
  const tool = requiredSpan(spans, "execute_tool run_commands");
  assertCapturedSpanParents(root, agent, model, tool);
  assertTeammateSpanParents(spans, agent);
  assertPrivateContentAbsent(spans);
  return root.spanContext().traceId;
}

function assertTeammateSpanParents(
  spans: CapturedSpan[],
  leadAgent: CapturedSpan,
) {
  const spawnTool = requiredSpan(spans, "execute_tool spawn_agent");
  const teammate = requiredAgentSpan(spans, "teammate");
  const tool = requiredSpan(spans, "execute_tool read_files");
  const model = spans.find(
    (span) =>
      span.name === "chat gpt-test" &&
      span.attributes["blame.agent.role"] === "teammate",
  );
  assert.ok(model);
  assert.equal(
    spawnTool.parentSpanContext?.spanId,
    leadAgent.spanContext().spanId,
  );
  assert.equal(
    teammate.parentSpanContext?.spanId,
    spawnTool.spanContext().spanId,
  );
  assert.equal(model.parentSpanContext?.spanId, teammate.spanContext().spanId);
  assert.equal(tool.parentSpanContext?.spanId, teammate.spanContext().spanId);
}

function assertCapturedSpanParents(
  root: CapturedSpan,
  agent: CapturedSpan,
  model: CapturedSpan,
  tool: CapturedSpan,
) {
  assert.equal(agent.parentSpanContext?.spanId, root.spanContext().spanId);
  assert.equal(model.parentSpanContext?.spanId, agent.spanContext().spanId);
  assert.equal(tool.parentSpanContext?.spanId, agent.spanContext().spanId);
  assert.equal(model.attributes["gen_ai.response.model"], "gpt-response");
}

function assertPrivateContentAbsent(spans: CapturedSpan[]) {
  const traceIds = new Set(spans.map((span) => span.spanContext().traceId));
  assert.equal(traceIds.size, 1);
  const serialized = JSON.stringify(
    spans.map((span) => ({
      attributes: span.attributes,
      events: span.events,
      name: span.name,
    })),
  );
  assert.equal(serialized.includes("private-secret"), false);
  assert.equal(serialized.includes("private model response"), false);
}

function requiredSpan(
  spans: ReturnType<InMemorySpanExporter["getFinishedSpans"]>,
  name: string,
) {
  const span = spans.find((candidate) => candidate.name === name);
  assert.ok(span, `Missing span ${name}`);
  return span;
}

function requiredAgentSpan(spans: CapturedSpan[], role: string) {
  const span = spans.find(
    (candidate) =>
      candidate.name === "invoke_agent" &&
      candidate.attributes["blame.agent.role"] === role,
  );
  assert.ok(span, `Missing ${role} agent span`);
  return span;
}

function assertCapturedMetrics(exporter: InMemoryMetricExporter) {
  const metricData = exporter
    .getMetrics()
    .flatMap((resource) => resource.scopeMetrics)
    .flatMap((scope) => scope.metrics);
  const tokens = metricData.find(
    (metric) => metric.descriptor.name === "gen_ai.client.token.usage",
  );
  assert.ok(tokens && tokens.dataPointType === DataPointType.HISTOGRAM);
  const tokenTotal = tokens.dataPoints.reduce(
    (total, point) => total + (point.value.sum ?? 0),
    0,
  );
  assert.equal(tokenTotal, 150);
  const serialized = JSON.stringify(metricData);
  assert.equal(serialized.includes("execution-integration"), false);
  assert.equal(serialized.includes("story-integration"), false);
  assert.equal(serialized.includes("private-secret"), false);
  assertHarnessMetrics(metricData);
}

function assertHarnessMetrics(
  metricData: ReturnType<
    InMemoryMetricExporter["getMetrics"]
  >[number]["scopeMetrics"][number]["metrics"],
) {
  for (const name of [
    "blame.harness.reads",
    "blame.harness.deduplicated_reads",
    "blame.harness.symbol_target_ratio",
  ])
    assert.ok(
      metricData.some((metric) => metric.descriptor.name === name),
      `Missing metric ${name}`,
    );
}

function assertCapturedLogs(
  records: ReturnType<InMemoryLogRecordExporter["getFinishedLogRecords"]>,
  traceId: string,
) {
  const completed = records.find(
    (record) => record.eventName === "blame.agent.completed",
  );
  assert.ok(completed?.spanContext);
  assert.equal(completed.spanContext.traceId, traceId);
  const serialized = JSON.stringify(
    records.map((record) => ({
      attributes: record.attributes,
      body: record.body,
      eventName: record.eventName,
    })),
  );
  assert.equal(serialized.includes("private-secret"), false);
  assert.equal(serialized.includes("private model response"), false);
}

function teammateEvent(agentId: string): CoreSessionEvent {
  return {
    payload: {
      event: { parentAgentId: "lead", type: "usage" },
      sessionId: "session",
      teamAgentId: agentId,
      teamRole: "teammate",
    },
    type: "agent_event",
  } as CoreSessionEvent;
}
