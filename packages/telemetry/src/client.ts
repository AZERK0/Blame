import {
  SpanKind,
  SpanStatusCode,
  context,
  metrics,
  trace,
  type Counter,
  type Context,
  type Histogram,
  type Span,
  type TimeInput,
} from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import {
  errorAttributes,
  metricAttributes,
  sanitizeAttributes,
  traceAttributes,
} from "./redaction.js";
import { metricInstrumentOptions } from "./metric-options.js";
import { ATTR_BLAME_OPERATION_STATUS } from "./semantic-attributes.js";

export { SpanKind } from "@opentelemetry/api";
export type { Context } from "@opentelemetry/api";

const instrumentationName = "@blame/telemetry";

export type TelemetrySeverity = "debug" | "info" | "warn" | "error";
export type TelemetryOutcome = "succeeded" | "failed" | "canceled";

export type StartSpanOptions = {
  attributes?: Record<string, unknown>;
  kind?: SpanKind;
  parent?: Context;
  startTime?: TimeInput;
};

export class BlameSpan {
  readonly context: Context;
  readonly span: Span;
  readonly startedAt = performance.now();
  private ended = false;

  constructor(span: Span, parent: Context) {
    this.span = span;
    this.context = trace.setSpan(parent, span);
  }

  setAttributes(attributes: Record<string, unknown>) {
    this.span.setAttributes(sanitizeAttributes(attributes));
    return this;
  }

  addEvent(name: string, attributes: Record<string, unknown> = {}) {
    this.span.addEvent(name, sanitizeAttributes(attributes));
    return this;
  }

  recordError(error: unknown) {
    const attributes = errorAttributes(error);
    this.span.recordException({
      name: String(attributes["exception.type"]),
    });
    this.span.setAttributes(sanitizeAttributes(attributes));
    this.span.setStatus({ code: SpanStatusCode.ERROR });
    return this;
  }

  end(outcome: TelemetryOutcome = "succeeded", endTime?: TimeInput) {
    if (this.ended) return;
    this.ended = true;
    this.span.setAttribute(ATTR_BLAME_OPERATION_STATUS, outcome);
    this.span.setStatus(spanStatus(outcome));
    this.span.end(endTime);
  }

  durationSeconds() {
    return Math.max(0, performance.now() - this.startedAt) / 1_000;
  }
}

export class BlameTelemetry {
  private readonly counters = new Map<string, Counter>();
  private readonly histograms = new Map<string, Histogram>();
  startSpan(name: string, options: StartSpanOptions = {}) {
    const parent = options.parent ?? context.active();
    const span = trace.getTracer(instrumentationName).startSpan(
      name,
      {
        attributes: sanitizeAttributes(options.attributes),
        kind: options.kind ?? SpanKind.INTERNAL,
        startTime: options.startTime,
      },
      parent,
    );
    return new BlameSpan(span, parent);
  }

  async withinSpan<T>(span: BlameSpan, operation: () => Promise<T>) {
    return context.with(span.context, operation);
  }

  count(
    name: string,
    value = 1,
    attributes: Record<string, unknown> = {},
    activeContext = context.active(),
  ) {
    this.counter(name).add(value, metricAttributes(attributes), activeContext);
  }

  record(
    name: string,
    value: number,
    attributes: Record<string, unknown> = {},
    activeContext = context.active(),
  ) {
    if (!Number.isFinite(value)) return;
    this.histogram(name).record(
      value,
      metricAttributes(attributes),
      activeContext,
    );
  }

  log(
    severity: TelemetrySeverity,
    eventName: string,
    attributes: Record<string, unknown> = {},
    activeContext = context.active(),
  ) {
    logs.getLogger(instrumentationName).emit({
      attributes: traceAttributes(attributes),
      body: eventName,
      context: activeContext,
      eventName,
      severityNumber: severityNumber(severity),
      severityText: severity.toUpperCase(),
    });
  }

  structuredLog(
    severity: TelemetrySeverity,
    eventName: string,
    attributes: Record<string, unknown> = {},
    activeContext = context.active(),
  ) {
    const activeSpan = trace.getSpan(activeContext)?.spanContext();
    return {
      timestamp: new Date().toISOString(),
      severity_text: severity.toUpperCase(),
      event_name: eventName,
      trace_id: activeSpan?.traceId,
      span_id: activeSpan?.spanId,
      attributes: traceAttributes(attributes),
    };
  }

  private counter(name: string) {
    const existing = this.counters.get(name);
    if (existing) return existing;
    const counter = metrics
      .getMeter(instrumentationName)
      .createCounter(name, metricInstrumentOptions(name));
    this.counters.set(name, counter);
    return counter;
  }

  private histogram(name: string) {
    const existing = this.histograms.get(name);
    if (existing) return existing;
    const histogram = metrics
      .getMeter(instrumentationName)
      .createHistogram(name, metricInstrumentOptions(name));
    this.histograms.set(name, histogram);
    return histogram;
  }
}

function spanStatus(outcome: TelemetryOutcome) {
  if (outcome === "failed") return { code: SpanStatusCode.ERROR };
  return { code: SpanStatusCode.OK };
}

function severityNumber(severity: TelemetrySeverity) {
  if (severity === "debug") return SeverityNumber.DEBUG;
  if (severity === "warn") return SeverityNumber.WARN;
  if (severity === "error") return SeverityNumber.ERROR;
  return SeverityNumber.INFO;
}
