import type {
  LogRecordExporter,
  ReadableLogRecord,
} from "@opentelemetry/sdk-logs";
import type {
  AggregationOption,
  AggregationTemporality,
  InstrumentType,
  PushMetricExporter,
  ResourceMetrics,
} from "@opentelemetry/sdk-metrics";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace";

type ExportCallback = Parameters<SpanExporter["export"]>[1];
type SelectableMetricExporter = PushMetricExporter & {
  selectAggregation(instrumentType: InstrumentType): AggregationOption;
  selectAggregationTemporality(
    instrumentType: InstrumentType,
  ): AggregationTemporality;
};

export class GatedSpanExporter implements SpanExporter {
  private readonly exporter: SpanExporter;
  private readonly isReady: () => boolean;

  constructor(exporter: SpanExporter, isReady: () => boolean) {
    this.exporter = exporter;
    this.isReady = isReady;
  }

  export(spans: ReadableSpan[], callback: ExportCallback) {
    exportWhenReady(this.isReady, callback, () =>
      this.exporter.export(spans, callback),
    );
  }

  forceFlush() {
    return runWhenReady(this.isReady, () => this.exporter.forceFlush?.());
  }

  shutdown() {
    return this.exporter.shutdown();
  }
}

export class GatedLogRecordExporter implements LogRecordExporter {
  private readonly exporter: LogRecordExporter;
  private readonly isReady: () => boolean;

  constructor(exporter: LogRecordExporter, isReady: () => boolean) {
    this.exporter = exporter;
    this.isReady = isReady;
  }

  export(logs: ReadableLogRecord[], callback: ExportCallback) {
    exportWhenReady(this.isReady, callback, () =>
      this.exporter.export(logs, callback),
    );
  }

  forceFlush() {
    return runWhenReady(this.isReady, () => this.exporter.forceFlush());
  }

  shutdown() {
    return this.exporter.shutdown();
  }
}

export class GatedMetricExporter implements PushMetricExporter {
  private readonly exporter: SelectableMetricExporter;
  private readonly isReady: () => boolean;

  constructor(exporter: SelectableMetricExporter, isReady: () => boolean) {
    this.exporter = exporter;
    this.isReady = isReady;
  }

  export(metrics: ResourceMetrics, callback: ExportCallback) {
    exportWhenReady(this.isReady, callback, () =>
      this.exporter.export(metrics, callback),
    );
  }

  forceFlush() {
    return runWhenReady(this.isReady, () => this.exporter.forceFlush());
  }

  selectAggregation(instrumentType: InstrumentType) {
    return this.exporter.selectAggregation(instrumentType);
  }

  selectAggregationTemporality(instrumentType: InstrumentType) {
    return this.exporter.selectAggregationTemporality(instrumentType);
  }

  shutdown() {
    return this.exporter.shutdown();
  }
}

function exportWhenReady(
  isReady: () => boolean,
  callback: ExportCallback,
  exportBatch: () => void,
) {
  if (isReady()) exportBatch();
  else callback({ code: 0 });
}

async function runWhenReady(
  isReady: () => boolean,
  action: () => Promise<void> | undefined,
) {
  if (isReady()) await action();
}
