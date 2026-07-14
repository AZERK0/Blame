import assert from "node:assert/strict";
import test from "node:test";
import {
  context,
  type Context,
  type Span,
  type TimeInput,
} from "@opentelemetry/api";
import {
  BlameSpan,
  BlameTelemetry,
  type StartSpanOptions,
  type TelemetryOutcome,
} from "./client.js";
import { ExecutionRegistry } from "./execution-registry.js";

type SpanEnding = {
  endTime?: TimeInput;
  name: string;
  outcome: TelemetryOutcome;
};

type MetricRecording = {
  attributes: Record<string, unknown>;
  name: string;
  value: number;
};

class RecordingSpan extends BlameSpan {
  private completed = false;

  constructor(
    private readonly name: string,
    private readonly telemetry: RecordingTelemetry,
  ) {
    super({} as Span, context.active());
  }

  setAttributes(_attributes: Record<string, unknown>) {
    return this;
  }

  recordError(_error: unknown) {
    return this;
  }

  end(outcome: TelemetryOutcome = "succeeded", endTime?: TimeInput) {
    if (this.completed) return;
    this.completed = true;
    this.telemetry.endings.push({ endTime, name: this.name, outcome });
  }

  durationSeconds() {
    return this.telemetry.elapsedSeconds;
  }
}

class RecordingTelemetry extends BlameTelemetry {
  elapsedSeconds = 0;
  readonly endings: SpanEnding[] = [];
  readonly recordings: MetricRecording[] = [];

  startSpan(name: string, _options: StartSpanOptions = {}) {
    return new RecordingSpan(name, this);
  }

  record(
    name: string,
    value: number,
    attributes: Record<string, unknown> = {},
    _activeContext: Context = context.active(),
  ) {
    this.recordings.push({ attributes, name, value });
  }
}

test("close ends active components before the root at a shared time", () => {
  const telemetry = new RecordingTelemetry();
  const registry = new ExecutionRegistry(telemetry);
  const descriptor = { executionId: "execution-close" };
  const completed = registry.beginComponent(descriptor, "component.completed");
  const active = registry.beginComponent(descriptor, "component.active");

  telemetry.elapsedSeconds = 2;
  completed.succeed(100);
  telemetry.elapsedSeconds = 8;
  registry.close(descriptor.executionId);

  assert.deepEqual(
    telemetry.endings.map(({ name }) => name),
    ["component.completed", "component.active", "blame.execution"],
  );
  assert.equal(telemetry.endings[1]?.endTime, telemetry.endings[2]?.endTime);
  assert.equal(executionDuration(telemetry), 8);
  active.succeed(200);
  assert.equal(telemetry.endings.length, 3);
});

test("shutdown closes every active component before its root", () => {
  const telemetry = new RecordingTelemetry();
  const registry = new ExecutionRegistry(telemetry);
  const descriptor = { executionId: "execution-shutdown" };
  const first = registry.beginComponent(descriptor, "component.first");
  registry.beginComponent(descriptor, "component.second");

  telemetry.elapsedSeconds = 5;
  registry.shutdown();

  assert.deepEqual(
    telemetry.endings.map(({ name }) => name),
    ["component.first", "component.second", "blame.execution"],
  );
  assert.equal(telemetry.endings[0]?.endTime, telemetry.endings[2]?.endTime);
  assert.equal(telemetry.endings[1]?.endTime, telemetry.endings[2]?.endTime);
  assert.equal(executionDuration(telemetry), 5);
  first.fail(new Error("late failure"), 300);
  assert.equal(telemetry.endings.length, 3);
});

test("a successful unrelated operation does not mask a failure", () => {
  const telemetry = new RecordingTelemetry();
  const registry = new ExecutionRegistry(telemetry);
  const descriptor = { executionId: "execution-unrelated" };
  const failed = registry.beginComponent(descriptor, "operation.a");
  const succeeded = registry.beginComponent(descriptor, "operation.b");

  failed.fail(new Error("operation failed"));
  succeeded.succeed();
  registry.close(descriptor.executionId, "succeeded");

  assert.equal(rootEnding(telemetry)?.outcome, "failed");
  assert.equal(executionRecovered(telemetry), false);
});

test("a later attempt of the failed operation records recovery", () => {
  const telemetry = new RecordingTelemetry();
  const registry = new ExecutionRegistry(telemetry);
  const descriptor = { executionId: "execution-recovered" };
  const failed = registry.beginComponent(descriptor, "operation.a");

  failed.fail(new Error("operation failed"));
  const retry = registry.beginComponent(descriptor, "operation.a");
  retry.succeed();
  registry.close(descriptor.executionId);

  assert.equal(rootEnding(telemetry)?.outcome, "succeeded");
  assert.equal(executionRecovered(telemetry), true);
});

test("a parallel attempt cannot recover a later failure", () => {
  const telemetry = new RecordingTelemetry();
  const registry = new ExecutionRegistry(telemetry);
  const descriptor = { executionId: "execution-parallel" };
  const failed = registry.beginComponent(descriptor, "operation.a");
  const parallel = registry.beginComponent(descriptor, "operation.a");

  failed.fail(new Error("operation failed"));
  parallel.succeed();
  registry.close(descriptor.executionId);

  assert.equal(rootEnding(telemetry)?.outcome, "failed");
  assert.equal(executionRecovered(telemetry), false);
});

function executionDuration(telemetry: RecordingTelemetry) {
  return telemetry.recordings.find(
    ({ name }) => name === "blame.execution.duration",
  )?.value;
}

function rootEnding(telemetry: RecordingTelemetry) {
  return telemetry.endings.find(({ name }) => name === "blame.execution");
}

function executionRecovered(telemetry: RecordingTelemetry) {
  return telemetry.recordings.find(
    ({ name }) => name === "blame.execution.duration",
  )?.attributes["blame.execution.recovered"];
}
