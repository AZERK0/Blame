import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { MySQL2Instrumentation } from "@opentelemetry/instrumentation-mysql2";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { RuntimeNodeInstrumentation } from "@opentelemetry/instrumentation-runtime-node";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import {
  PeriodicExportingMetricReader,
  createAllowListAttributesProcessor,
  type ViewOptions,
} from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { BlameTelemetry } from "./client.js";
import {
  loadTelemetryConfig,
  otlpSignalEndpoint,
  type BlameTelemetryConfig,
  type BlameTelemetryOptions,
} from "./config.js";
import { ExecutionRegistry } from "./execution-registry.js";
import { RedactingSpanProcessor } from "./redacting-span-processor.js";
import { allowedMetricAttributeKeys } from "./redaction.js";
import { ATTR_DEPLOYMENT_ENVIRONMENT_NAME } from "./semantic-attributes.js";

let activeConfig: BlameTelemetryConfig | undefined;
let nodeSdk: NodeSDK | undefined;
let shutdownPromise: Promise<void> | undefined;
const telemetry = new BlameTelemetry();
const executions = new ExecutionRegistry(telemetry);

export function initializeBlameTelemetry(
  options: BlameTelemetryOptions,
): BlameTelemetryConfig {
  if (activeConfig) return activeConfig;
  activeConfig = loadTelemetryConfig(options);
  if (!activeConfig.enabled) return activeConfig;
  try {
    nodeSdk = createNodeSdk(activeConfig);
    nodeSdk.start();
  } catch {
    nodeSdk = undefined;
    activeConfig = { ...activeConfig, enabled: false };
    writeTelemetryDiagnostic("blame.telemetry.initialization_failed");
  }
  return activeConfig;
}

export function getBlameTelemetry() {
  return telemetry;
}

export function getExecutionRegistry() {
  return executions;
}

export async function shutdownBlameTelemetry(timeoutMs = 3_000) {
  if (shutdownPromise) return shutdownPromise;
  executions.shutdown();
  shutdownPromise = shutdownSdk(timeoutMs);
  return shutdownPromise;
}

function createNodeSdk(config: BlameTelemetryConfig) {
  const endpoint = config.endpoint;
  if (!endpoint) throw new Error("OTLP endpoint is required");
  return new NodeSDK({
    autoDetectResources: false,
    instrumentations: createInstrumentations(config.serviceName),
    logRecordProcessors: createLogProcessors(endpoint),
    metricReaders: createMetricReaders(endpoint, config.exportIntervalMs),
    resource: createResource(config),
    spanProcessors: createSpanProcessors(endpoint),
    views: createMetricViews(),
  });
}

function createLogProcessors(endpoint: string) {
  return [
    new BatchLogRecordProcessor({
      exporter: new OTLPLogExporter({
        url: otlpSignalEndpoint(endpoint, "logs"),
      }),
    }),
  ];
}

function createMetricReaders(endpoint: string, exportIntervalMs: number) {
  return [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: otlpSignalEndpoint(endpoint, "metrics"),
      }),
      exportIntervalMillis: exportIntervalMs,
    }),
  ];
}

function createSpanProcessors(endpoint: string) {
  const exporter = new OTLPTraceExporter({
    url: otlpSignalEndpoint(endpoint, "traces"),
  });
  return [new RedactingSpanProcessor(), new BatchSpanProcessor({ exporter })];
}

function createMetricViews(): ViewOptions[] {
  return [
    metricView("@blame/telemetry", [...allowedMetricAttributeKeys]),
    metricView("@opentelemetry/instrumentation-http", httpMetricKeys),
    metricView("@opentelemetry/instrumentation-undici", httpMetricKeys),
  ];
}

function metricView(meterName: string, attributeKeys: string[]): ViewOptions {
  return {
    aggregationCardinalityLimit: 200,
    attributesProcessors: [createAllowListAttributesProcessor(attributeKeys)],
    instrumentName: "*",
    meterName,
  };
}

function createInstrumentations(serviceName: string) {
  return [
    new HttpInstrumentation({
      redactedQueryParams: sensitiveQueryParameters,
    }),
    new UndiciInstrumentation({ requireParentforSpans: true }),
    new RuntimeNodeInstrumentation({ monitoringPrecision: 10_000 }),
    new MySQL2Instrumentation({
      enabled: serviceName === "blame-api",
      maskStatement: true,
      maskStatementHook: () => "[REDACTED]",
    }),
    new PinoInstrumentation({
      disableLogSending: true,
      logKeys: {
        spanId: "span_id",
        traceFlags: "trace_flags",
        traceId: "trace_id",
      },
    }),
  ];
}

function createResource(config: BlameTelemetryConfig) {
  return resourceFromAttributes({
    ...config.resourceAttributes,
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: config.deploymentEnvironment,
    "host.arch": process.arch,
    "os.type": process.platform,
    "process.runtime.name": "nodejs",
    "process.runtime.version": process.versions.node,
    [ATTR_SERVICE_NAME]: config.serviceName,
    [ATTR_SERVICE_VERSION]: config.serviceVersion,
  });
}

async function shutdownSdk(timeoutMs: number) {
  if (!nodeSdk) return;
  const timeout = createTimeout(timeoutMs);
  try {
    await Promise.race([nodeSdk.shutdown(), timeout.promise]);
  } catch {
    writeTelemetryDiagnostic("blame.telemetry.shutdown_failed");
  } finally {
    timeout.cancel();
  }
}

function writeTelemetryDiagnostic(eventName: string) {
  console.warn(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      severity_text: "WARN",
      event_name: eventName,
    }),
  );
}

function createTimeout(timeoutMs: number) {
  let timer: NodeJS.Timeout;
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
    timer.unref();
  });
  return { cancel: () => clearTimeout(timer), promise };
}

const sensitiveQueryParameters = [
  "AWSAccessKeyId",
  "Signature",
  "X-Goog-Signature",
  "access_token",
  "api_key",
  "authorization",
  "code",
  "credential",
  "key",
  "password",
  "refresh_token",
  "secret",
  "sig",
  "token",
];

const httpMetricKeys = [
  "http.method",
  "http.request.method",
  "http.response.status_code",
  "http.route",
  "http.status_code",
  "network.protocol.version",
  "server.address",
  "server.port",
  "url.scheme",
];
