import assert from "node:assert/strict";
import test from "node:test";
import type { PreviewExecutionPlan } from "@blame/preview-runtime";
import { initialRuntimeState } from "./runtime-state.js";
import { resumeRuntimeState } from "./runner-application.js";

test("resumes the persisted Compose plan with a new generation", () => {
  const state = {
    ...initialRuntimeState(),
    prepared: true,
    running: true,
    sessionId: "session-1",
    generation: 2,
    selection: { configurationId: "web", serviceIds: ["app", "api"] },
    plan: plan(2),
  };

  const resumed = resumeRuntimeState(state, "session-1", 3);

  assert.equal(resumed.prepared, true);
  assert.equal(resumed.running, false);
  assert.equal(resumed.generation, 3);
  assert.equal(resumed.selection, undefined);
  assert.equal(resumed.plan?.version, 2);
});

test("refuses a persisted obsolete execution plan", () => {
  const state = {
    ...initialRuntimeState(),
    prepared: true,
    sessionId: "session-1",
    generation: 1,
    plan: plan(1),
  };

  assert.throws(
    () => resumeRuntimeState(state, "session-1", 2),
    (error: unknown) =>
      (error as { runnerCode?: string }).runnerCode === "STALE_EXECUTION_PLAN",
  );
});

function plan(version: number) {
  return {
    version,
    workspaceRoot: "/workspace",
    setup: [],
    services: [],
    caches: [],
    probes: [],
    environmentPlan: { entries: [], cleanupRequired: true },
    networking: {
      gatewayListeners: [],
      loopbackGroups: [],
      publishedPortCount: 0,
      browserBindingCount: 0,
      requiresSharedLoopback: false,
      requiresWebSockets: false,
      integratedPreviewRequired: false,
      incompatibilityReasons: [],
    },
    detectedCompatibility: [],
  } as PreviewExecutionPlan;
}
