import assert from "node:assert/strict";
import test from "node:test";
import { workspaceTelemetryStep } from "./workspace-step-telemetry.ts";

test("maps fixed workspace steps to bounded telemetry identities", () => {
  assert.deepEqual(workspaceTelemetryStep("git repository ensure"), {
    category: "git",
    name: "git.repository_ensure",
  });
  assert.deepEqual(workspaceTelemetryStep("preview response wait"), {
    category: "preview",
    name: "preview.response_wait",
  });
});

test("does not include dynamic compose values in telemetry identities", () => {
  const first = workspaceTelemetryStep("compose setup service private-api");
  const second = workspaceTelemetryStep("compose setup service customer-db");
  const serialized = JSON.stringify([first, second]);

  assert.deepEqual(first, second);
  assert.doesNotMatch(serialized, /private-api|customer-db/);
});

test("uses a bounded fallback for unknown or sensitive labels", () => {
  const telemetryStep = workspaceTelemetryStep(
    "run /private/repository with token=secret",
  );

  assert.deepEqual(telemetryStep, {
    category: "setup",
    name: "setup.other",
  });
  assert.doesNotMatch(JSON.stringify(telemetryStep), /private|secret|token/);
});
