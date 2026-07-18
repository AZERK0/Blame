import assert from "node:assert/strict";
import test from "node:test";
import {
  sendRuntimeDiagnostic,
  type RuntimeDiagnosticDependencies,
} from "./runtime-diagnostic.ts";

function capturingDependencies(ready = true) {
  const logs: Array<{
    attributes: Record<string, unknown>;
    eventName: string;
    severity: string;
  }> = [];
  let flushCount = 0;
  const dependencies: RuntimeDiagnosticDependencies = {
    flush: async () => {
      flushCount += 1;
    },
    ready: () => ready,
    telemetry: {
      log: (severity, eventName, attributes) =>
        logs.push({ attributes, eventName, severity }),
    },
  };
  return { dependencies, flushCount: () => flushCount, logs };
}

test("submits an explicit runtime diagnostic and flushes telemetry", async () => {
  const capture = capturingDependencies();
  const sent = await sendRuntimeDiagnostic(
    { detail: "Lima failed to create the VM", operation: "ensure" },
    capture.dependencies,
  );

  assert.equal(sent, true);
  assert.equal(capture.flushCount(), 1);
  assert.equal(capture.logs.length, 1);
  assert.equal(
    capture.logs[0]?.attributes["blame.runtime.diagnostic.detail"],
    "Lima failed to create the VM",
  );
});

test("does not submit diagnostics without an active telemetry session", async () => {
  const capture = capturingDependencies(false);
  const sent = await sendRuntimeDiagnostic(
    { detail: "runtime failure", operation: "repair" },
    capture.dependencies,
  );

  assert.equal(sent, false);
  assert.equal(capture.flushCount(), 0);
  assert.equal(capture.logs.length, 0);
});

test("rejects malformed runtime diagnostics", async () => {
  const capture = capturingDependencies();
  const sent = await sendRuntimeDiagnostic(
    { detail: "runtime failure", operation: "uninstall" },
    capture.dependencies,
  );

  assert.equal(sent, false);
  assert.equal(capture.logs.length, 0);
});
