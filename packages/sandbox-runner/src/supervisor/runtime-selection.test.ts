import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PreviewExecutionPlan } from "@blame/preview-runtime";
import { normalizeRuntimeSelection } from "./runtime-selection.js";

const plan = {
  version: 1,
  workspaceRoot: "/workspace",
  setup: [],
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
  services: [
    service("database"),
    service("api", ["database"]),
    service("web", ["api"]),
  ],
} satisfies PreviewExecutionPlan;

describe("runtime service selection", () => {
  it("adds the complete dependency closure", () => {
    assert.deepEqual(normalizeRuntimeSelection(plan, {
      configurationId: "web",
      serviceIds: ["web"],
    }), {
      configurationId: "web",
      serviceIds: ["web", "api", "database"],
    });
  });

  it("rejects an unknown service", () => {
    assert.throws(() => normalizeRuntimeSelection(plan, {
      configurationId: "invalid",
      serviceIds: ["other"],
    }), /Unknown selected services/);
  });
});

function service(id: string, dependsOn: string[] = []) {
  return {
    id,
    kind: "preview" as const,
    source: { kind: "process" as const, toolchain: "node24" },
    workingDir: "/workspace",
    command: "true",
    environment: {},
    dependsOn,
    endpoints: [],
    bindings: [],
  };
}
