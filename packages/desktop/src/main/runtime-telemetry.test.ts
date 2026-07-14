import assert from "node:assert/strict";
import test from "node:test";
import {
  RuntimeTelemetry,
  type RuntimeTelemetryClient,
  type RuntimeTelemetryReport,
  type RuntimeTelemetrySpan,
} from "./runtime-telemetry.ts";
import { createRuntimeManager } from "./runtime-manager.ts";
import type {
  Context,
  StartSpanOptions,
  TelemetryOutcome,
  TelemetrySeverity,
} from "@blame/telemetry";

type CapturedMetric = {
  attributes: Record<string, unknown>;
  name: string;
  value: number;
};

type CapturedLog = {
  attributes: Record<string, unknown>;
  eventName: string;
  severity: TelemetrySeverity;
};

class CapturedSpan implements RuntimeTelemetrySpan {
  readonly attributes: Record<string, unknown>;
  readonly context = {} as Context;
  readonly name: string;
  errorType?: string;
  outcome?: TelemetryOutcome;

  constructor(name: string, attributes: Record<string, unknown>) {
    this.attributes = { ...attributes };
    this.name = name;
  }

  durationSeconds() {
    return 0.25;
  }

  end(outcome: TelemetryOutcome = "succeeded") {
    this.outcome = outcome;
  }

  recordError(error: unknown) {
    this.errorType = error instanceof Error ? error.name : "Error";
    return this;
  }

  setAttributes(attributes: Record<string, unknown>) {
    Object.assign(this.attributes, attributes);
    return this;
  }
}

class CapturingTelemetryClient implements RuntimeTelemetryClient {
  readonly counts: CapturedMetric[] = [];
  readonly logs: CapturedLog[] = [];
  readonly records: CapturedMetric[] = [];
  readonly spans: CapturedSpan[] = [];

  count(name: string, value: number, attributes: Record<string, unknown>) {
    this.counts.push({ attributes, name, value });
  }

  log(
    severity: TelemetrySeverity,
    eventName: string,
    attributes: Record<string, unknown>,
  ) {
    this.logs.push({ attributes, eventName, severity });
  }

  record(name: string, value: number, attributes: Record<string, unknown>) {
    this.records.push({ attributes, name, value });
  }

  startSpan(name: string, options?: StartSpanOptions) {
    const span = new CapturedSpan(name, options?.attributes ?? {});
    this.spans.push(span);
    return span;
  }

  withinSpan<T>(_span: RuntimeTelemetrySpan, action: () => Promise<T>) {
    return action();
  }
}

test("records runtime setup phases and bounded dependency issues", async () => {
  const client = new CapturingTelemetryClient();
  const telemetry = new RuntimeTelemetry(client);
  await telemetry.runOperation("blame-wsl2", "ensure", async (operation) => {
    operation.initial(missingRuntimeReport());
    await operation.phase("status_check", () =>
      operation.probe("blame-runtime", "status", async () => "missing"),
    );
    await operation.phase("lifecycle_command", async () => "ready");
    operation.readinessPolls(3);
    return readyRuntimeReport();
  });
  assertSuccessfulRuntimeTelemetry(client);
});

test("records failed repairs without exporting private errors", async () => {
  const client = new CapturingTelemetryClient();
  const telemetry = new RuntimeTelemetry(client);
  await assert.rejects(
    telemetry.runOperation("blame-lima", "repair", (operation) =>
      operation.phase("lifecycle_command", async () => {
        throw new Error("private runtime command output");
      }),
    ),
  );
  assertFailedRuntimeTelemetry(client);
});

test("instruments the complete WSL2 ensure workflow", async () => {
  const client = new CapturingTelemetryClient();
  let ready = false;
  const manager = createRuntimeManager(
    { platform: "win32" },
    async (_command, args) => {
      if (args[0] === "ensure") ready = true;
      if (args[0] === "status") return ready ? "ready" : "missing";
      return "ready";
    },
    new RuntimeTelemetry(client),
  );
  const report = await manager.ensureRuntimeReady();
  assert.equal(report.status, "ready");
  assert.deepEqual(runtimeSpanNames(client), [
    "blame.runtime.ensure",
    "blame.runtime.status_check",
    "blame.runtime.probe.binary",
    "blame.runtime.probe.status",
    "blame.runtime.lifecycle_command",
    "blame.runtime.readiness_wait",
  ]);
});

test("marks a completed but non-ready wait as failed", async () => {
  const client = new CapturingTelemetryClient();
  const telemetry = new RuntimeTelemetry(client);
  await telemetry.runOperation("blame-lima", "repair", async (operation) => {
    return operation.phase(
      "readiness_wait",
      async () => missingRuntimeReport(),
      () => "failed",
    );
  });
  const phase = requiredSpan(client, "blame.runtime.readiness_wait");
  assert.equal(phase.outcome, "failed");
  assert.equal(phase.attributes["error.type"], "RuntimeError");
});

test("does not count an expected missing runtime after uninstall", async () => {
  const client = new CapturingTelemetryClient();
  const telemetry = new RuntimeTelemetry(client);
  await telemetry.runOperation("blame-wsl2", "uninstall", async () =>
    missingRuntimeReport(),
  );
  const root = requiredSpan(client, "blame.runtime.uninstall");
  assert.equal(root.outcome, "succeeded");
  assert.equal(
    client.counts.some(
      ({ name }) => name === "blame.runtime.dependency.issue.count",
    ),
    false,
  );
});

function assertSuccessfulRuntimeTelemetry(client: CapturingTelemetryClient) {
  const root = requiredSpan(client, "blame.runtime.ensure");
  assert.equal(root.outcome, "succeeded");
  assert.equal(root.attributes["blame.runtime.initial_state"], "missing");
  assert.equal(root.attributes["blame.runtime.state"], "ready");
  assert.equal(root.attributes["blame.runtime.readiness.poll_count"], 3);
  assertMetric(client.counts, "blame.runtime.operation.count", "blame-wsl2");
  assertMetric(client.counts, "blame.runtime.phase.count", "blame-wsl2");
  assertMetric(client.counts, "blame.runtime.probe.count", "blame-wsl2");
  const readiness = requiredMetric(
    client.records,
    "blame.runtime.readiness.polls",
  );
  assert.equal(readiness.value, 3);
  assert.equal(readiness.attributes["blame.runtime.state"], "ready");
  assert.equal(readiness.attributes["blame.execution.status"], "succeeded");
  assertMetric(
    client.counts,
    "blame.runtime.dependency.issue.count",
    "blame-wsl2",
  );
  const issue = requiredMetric(
    client.counts,
    "blame.runtime.dependency.issue.count",
  );
  assert.equal(issue.attributes["blame.runtime.state"], "missing");
}

function assertFailedRuntimeTelemetry(client: CapturingTelemetryClient) {
  const root = requiredSpan(client, "blame.runtime.repair");
  const phase = requiredSpan(client, "blame.runtime.lifecycle_command");
  assert.equal(root.outcome, "failed");
  assert.equal(phase.outcome, "failed");
  assert.equal(root.attributes["error.type"], "RuntimeError");
  assert.equal(client.logs[0]?.severity, "error");
  assert.equal(
    JSON.stringify(client).includes("private runtime command output"),
    false,
  );
}

function assertMetric(
  metrics: CapturedMetric[],
  name: string,
  runtime: string,
) {
  const metric = requiredMetric(metrics, name);
  assert.equal(metric.attributes["blame.runtime.name"], runtime);
}

function requiredMetric(metrics: CapturedMetric[], name: string) {
  const metric = metrics.find((candidate) => candidate.name === name);
  assert.ok(metric, `Missing metric ${name}`);
  return metric;
}

function requiredSpan(client: CapturingTelemetryClient, name: string) {
  const span = client.spans.find((candidate) => candidate.name === name);
  assert.ok(span, `Missing span ${name}`);
  return span;
}

function runtimeSpanNames(client: CapturingTelemetryClient) {
  return client.spans.map(({ name }) => name);
}

function missingRuntimeReport(): RuntimeTelemetryReport {
  return {
    issues: [{ name: "blame-runtime", status: "missing" }],
    status: "missing",
  };
}

function readyRuntimeReport(): RuntimeTelemetryReport {
  return { issues: [], status: "ready" };
}
