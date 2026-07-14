import type { Context } from "@opentelemetry/api";
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from "@opentelemetry/sdk-trace";
import { traceAttributes } from "./redaction.js";

export { boundedErrorType } from "./redaction.js";

const instrumentationName = "@blame/telemetry";
const httpInstrumentationNames = new Set([
  "@opentelemetry/instrumentation-http",
  "@opentelemetry/instrumentation-undici",
]);
const mysqlInstrumentationName = "@opentelemetry/instrumentation-mysql2";
const sqlOperations = new Set([
  "ALTER",
  "CALL",
  "CREATE",
  "DELETE",
  "DROP",
  "INSERT",
  "REPLACE",
  "SELECT",
  "SHOW",
  "TRUNCATE",
  "UPDATE",
]);

export class RedactingSpanProcessor implements SpanProcessor {
  onStart(_span: Span, _parentContext: Context) {}

  onEnding(span: Span) {
    redactSpan(span);
  }

  onEnd(_span: ReadableSpan) {}

  forceFlush() {
    return Promise.resolve();
  }

  shutdown() {
    return Promise.resolve();
  }
}

function redactSpan(span: Span) {
  replaceAttributes(span.attributes);
  span.events.forEach((event) => replaceOptionalAttributes(event));
  span.links.forEach((link) => replaceOptionalAttributes(link));
  if (span.instrumentationScope.name === instrumentationName) return;
  redactAutomaticErrors(span);
  normalizeHttpSpan(span);
  normalizeDatabaseSpan(span);
}

function redactAutomaticErrors(span: Span) {
  delete span.attributes["error.message"];
  delete span.attributes["exception.message"];
  span.events.forEach((event) => {
    if (!event.attributes) return;
    delete event.attributes["exception.message"];
  });
  span.setStatus({ code: span.status.code });
}

function normalizeDatabaseSpan(span: Span) {
  if (span.instrumentationScope.name !== mysqlInstrumentationName) return;
  span.updateName(sqlSpanName(span.name));
}

function normalizeHttpSpan(span: Span) {
  if (!httpInstrumentationNames.has(span.instrumentationScope.name)) return;
  span.updateName(httpSpanName(span.attributes));
}

export function httpSpanName(attributes: Record<string, unknown>) {
  const value = attributes["http.request.method"] ?? attributes["http.method"];
  if (typeof value !== "string") return "HTTP";
  const method = value.toUpperCase();
  return /^[A-Z]{3,16}$/.test(method) ? method : "HTTP";
}

export function sqlSpanName(value: string) {
  const operation = value.trim().split(/\s+/, 1)[0]?.toUpperCase();
  return operation && sqlOperations.has(operation) ? operation : "SQL";
}

function replaceOptionalAttributes(target: {
  attributes?: Record<string, unknown>;
}) {
  if (target.attributes) replaceAttributes(target.attributes);
}

function replaceAttributes(attributes: Record<string, unknown>) {
  const sanitized = traceAttributes(attributes);
  Object.keys(attributes).forEach((key) => delete attributes[key]);
  Object.assign(attributes, sanitized);
}
