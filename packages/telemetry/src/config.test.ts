import assert from "node:assert/strict";
import test from "node:test";
import { context, metrics, trace } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { BlameTelemetry } from "./client.js";
import { loadTelemetryConfig, otlpSignalEndpoint } from "./config.js";
import {
  genAiDurationBucketBoundaries,
  genAiTokenBucketBoundaries,
  semanticGenAiProviderName,
} from "./gen-ai.js";
import {
  boundedErrorType,
  httpSpanName,
  sqlSpanName,
} from "./redacting-span-processor.js";
import { metricInstrumentOptions } from "./metric-options.js";
import {
  boundedMetricDimensionName,
  metricAttributes,
  sanitizeAttributes,
  sanitizeText,
  traceAttributes,
  withoutTelemetryEnvironment,
} from "./redaction.js";

const options = { serviceName: "blame-test", serviceVersion: "1.2.3" };

test("requires a valid generic OTLP endpoint", () => {
  assert.equal(
    loadTelemetryConfig({ ...options, environment: {} }).enabled,
    false,
  );
  assert.equal(
    loadTelemetryConfig({
      ...options,
      environment: { OTEL_LOGS_EXPORTER: "otlp" },
    }).enabled,
    false,
  );
  assert.equal(
    loadTelemetryConfig({
      ...options,
      environment: { OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.test" },
    }).enabled,
    true,
  );
});

test("honors the SDK disable switch", () => {
  const config = loadTelemetryConfig({
    ...options,
    environment: {
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.test",
      OTEL_SDK_DISABLED: "true",
    },
  });
  assert.equal(config.enabled, false);
});

test("derives signal endpoints only from the generic endpoint", () => {
  assert.equal(
    otlpSignalEndpoint("https://collector.test/otlp/", "traces"),
    "https://collector.test/otlp/v1/traces",
  );
  assert.equal(
    loadTelemetryConfig({
      ...options,
      environment: {
        OTEL_EXPORTER_OTLP_ENDPOINT:
          "https://collector.test?authorization=secret",
      },
    }).enabled,
    false,
  );
});

test("keeps only approved resource attributes", () => {
  const config = loadTelemetryConfig({
    ...options,
    environment: {
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.test",
      OTEL_RESOURCE_ATTRIBUTES:
        "deployment.environment.name=staging,service.instance.id=node-1,user.id=private",
    },
  });
  assert.deepEqual(config.resourceAttributes, {
    "deployment.environment.name": "staging",
    "service.instance.id": "node-1",
  });
});

test("redacts sensitive keys and values", () => {
  const attributes = sanitizeAttributes({
    "blame.execution.id": "execution-1",
    "gen_ai.input.messages": "private prompt",
    authorization: "Bearer secret-token",
    file_content: "private source",
    safe: "token=secret-value",
  });
  assert.equal(attributes["blame.execution.id"], "execution-1");
  assert.equal(attributes["gen_ai.input.messages"], undefined);
  assert.equal(attributes.authorization, undefined);
  assert.equal(attributes.file_content, undefined);
  assert.equal(attributes.safe, "[REDACTED]");
  assert.equal(sanitizeText("Bearer abcdefghijklmnop"), "[REDACTED]");
  assert.equal(sanitizeText("auth Bearer abcdefghijklmnop"), "auth [REDACTED]");
  assert.equal(sanitizeText("access_token=private-token"), "[REDACTED]");
  assert.equal(sanitizeText("ghp_abcdefghijklmnopqrstuvwxyz"), "[REDACTED]");
  assert.equal(sanitizeText("eyJheader.eyJpayload.signature"), "[REDACTED]");
  assert.equal(
    sanitizeText(`${"x".repeat(1_009)} sk-abcdefghijklmnop`).includes(
      "sk-abcdefghijk",
    ),
    false,
  );
  assert.equal(
    sanitizeText("https://user:password@example.test/path"),
    "https://[REDACTED]@example.test/path",
  );
});

test("removes private auto-instrumentation trace attributes", () => {
  assert.deepEqual(
    traceAttributes({
      "http.request.method": "GET",
      "server.address": "api.example.test",
      "url.full": "https://api.example.test?token=secret",
      "url.path": "/private/repository",
      "url.query": "token=secret",
      "exception.message":
        "Command failed: git status /private/repository secret-source",
      "exception.stacktrace": "/private/source.ts:10",
      "process.command_line": "private --argument",
      "url.original": "https://api.example.test/private",
    }),
    {
      "http.request.method": "GET",
      "server.address": "api.example.test",
    },
  );
});

test("bounds automatic error types and database span names", () => {
  assert.equal(boundedErrorType("ECONNREFUSED"), "ECONNREFUSED");
  assert.equal(boundedErrorType("request failed with private data"), "Error");
  assert.equal(sqlSpanName("select"), "SELECT");
  assert.equal(sqlSpanName("private-query-without-operation"), "SQL");
  assert.equal(httpSpanName({ "http.request.method": "GET" }), "GET");
  assert.equal(
    httpSpanName({ "http.request.method": "/private/path" }),
    "HTTP",
  );
});

test("defines semantic metric units", () => {
  assert.equal(
    metricInstrumentOptions("gen_ai.client.operation.duration").unit,
    "s",
  );
  assert.equal(
    metricInstrumentOptions("gen_ai.client.token.usage").unit,
    "{token}",
  );
  assert.equal(
    metricInstrumentOptions("blame.gen_ai.cache_read_token.usage").unit,
    "{token}",
  );
  assert.equal(
    metricInstrumentOptions("blame.gen_ai.cache_creation_token.usage").unit,
    "{token}",
  );
  assert.equal(metricInstrumentOptions("blame.tool.duration").unit, "s");
  assert.equal(
    metricInstrumentOptions("blame.agent.retry.count").unit,
    "{retry}",
  );
  assert.equal(
    metricInstrumentOptions("blame.agent.retries_per_execution").unit,
    "{retry}",
  );
});

test("defines semantic GenAI histogram boundaries", () => {
  assert.deepEqual(
    metricInstrumentOptions("gen_ai.client.operation.duration").advice
      ?.explicitBucketBoundaries,
    genAiDurationBucketBoundaries,
  );
  assert.deepEqual(
    metricInstrumentOptions("gen_ai.client.token.usage").advice
      ?.explicitBucketBoundaries,
    genAiTokenBucketBoundaries,
  );
});

test("removes unbounded metric dimensions", () => {
  const attributes = metricAttributes({
    "blame.agent.role": "lead",
    "blame.execution.id": "execution-1",
    "blame.execution.kind": "agent",
    "blame.story.id": "story-1",
    "exception.message": "private failure",
    "file.path": "/private/path",
    "gen_ai.request.model": "gpt-test",
  });
  assert.deepEqual(attributes, {
    "blame.agent.role": "lead",
    "blame.execution.kind": "agent",
    "gen_ai.request.model": "gpt-test",
  });
});

test("bounds model and provider metric dimensions", () => {
  assert.equal(
    boundedMetricDimensionName("openai/gpt-test"),
    "openai/gpt-test",
  );
  assert.equal(
    boundedMetricDimensionName("https://private.test/model"),
    "other",
  );
  assert.equal(boundedMetricDimensionName("private model name"), "other");
  assert.equal(boundedMetricDimensionName("sk-abcdefghijklmnop"), "other");
  assert.equal(semanticGenAiProviderName("openai-codex"), "openai");
  assert.equal(semanticGenAiProviderName("vertex-ai"), "gcp.vertex_ai");
});

test("strips telemetry configuration from child environments", () => {
  assert.deepEqual(
    withoutTelemetryEnvironment({
      HOME: "/home/test",
      OTEL_EXPORTER_OTLP_HEADERS: "authorization=secret",
      otel_sdk_disabled: "false",
    }),
    { HOME: "/home/test" },
  );
});

test("formats structured logs with trace correlation", () => {
  const activeContext = trace.setSpanContext(context.active(), {
    isRemote: false,
    spanId: "0123456789abcdef",
    traceFlags: 1,
    traceId: "0123456789abcdef0123456789abcdef",
  });
  const record = new BlameTelemetry().structuredLog(
    "error",
    "blame.test.failed",
    {
      "error.type": "AssertionError",
      "file.path": "/private/repository/source.ts",
      "url.full": "https://example.test/private",
    },
    activeContext,
  );
  assert.equal(record.trace_id, "0123456789abcdef0123456789abcdef");
  assert.equal(record.span_id, "0123456789abcdef");
  assert.equal(record.event_name, "blame.test.failed");
  assert.equal(record.attributes["file.path"], undefined);
  assert.equal(record.attributes["url.full"], undefined);
});

test("acquires the meter after provider initialization", async () => {
  const client = new BlameTelemetry();
  const exporter = new InMemoryMetricExporter(
    AggregationTemporality.CUMULATIVE,
  );
  const reader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: 60_000,
  });
  const provider = new MeterProvider({ readers: [reader] });
  metrics.setGlobalMeterProvider(provider);
  client.count("blame.execution.count");
  await provider.forceFlush();
  const names = exporter
    .getMetrics()
    .flatMap((resource) => resource.scopeMetrics)
    .flatMap((scope) => scope.metrics)
    .map((metric) => metric.descriptor.name);
  assert.deepEqual(names, ["blame.execution.count"]);
  await provider.shutdown();
  metrics.disable();
});
