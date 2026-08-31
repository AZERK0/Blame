import type {
  AdapterCapabilityManifest,
  HarnessResult,
} from "@blame/harness-core";
import type {
  SemanticWorkspaceExecutionRequest,
  CanonicalSemanticWorkspaceExecutor,
} from "./semantic-executor.js";

export type HarnessAdapter = {
  capabilities: AdapterCapabilityManifest;
  execute: CanonicalSemanticWorkspaceExecutor;
};

export type AdapterConformanceScenario = {
  scenario_id: string;
  request: SemanticWorkspaceExecutionRequest;
  assert(result: HarnessResult<unknown, unknown>): void;
};

export type AdapterConformanceResult = {
  adapter_id: string;
  scenario_id: string;
  normalized_result: unknown;
};

export async function runAdapterConformance(
  adapters: HarnessAdapter[],
  scenarios: AdapterConformanceScenario[],
) {
  const results: AdapterConformanceResult[] = [];
  for (const scenario of scenarios) {
    const scenarioResults = await Promise.all(
      adapters.map((adapter) => executeScenario(adapter, scenario)),
    );
    assertEquivalentScenario(scenario.scenario_id, scenarioResults);
    results.push(...scenarioResults);
  }
  return results;
}

export const headlessAdapterCapabilities: AdapterCapabilityManifest = {
  adapter_id: "headless",
  adapter_version: "3",
  transport: "in_process",
  streaming: "unavailable",
  cancellation: "cooperative",
  compaction: "core",
};

export const clineAdapterCapabilities: AdapterCapabilityManifest = {
  adapter_id: "cline",
  adapter_version: "3",
  transport: "in_process",
  streaming: "native",
  cancellation: "native",
  compaction: "native",
};

async function executeScenario(
  adapter: HarnessAdapter,
  scenario: AdapterConformanceScenario,
): Promise<AdapterConformanceResult> {
  const result = await adapter.execute(scenario.request);
  scenario.assert(result);
  return {
    adapter_id: adapter.capabilities.adapter_id,
    scenario_id: scenario.scenario_id,
    normalized_result: normalizeResult(result),
  };
}

function assertEquivalentScenario(
  scenarioId: string,
  results: AdapterConformanceResult[],
) {
  const signatures = new Set(
    results.map((result) => JSON.stringify(result.normalized_result)),
  );
  if (signatures.size > 1)
    throw new Error(`ADAPTER_CONFORMANCE_MISMATCH:${scenarioId}`);
}

function normalizeResult(result: HarnessResult<unknown, unknown>) {
  return {
    protocol_version: result.protocol_version,
    outcome: result.outcome,
    effect: result.effect,
    satisfaction: result.satisfaction,
    data: result.data,
    evidence: [...result.evidence].sort(),
    ...(result.outcome === "blocked"
      ? { issue: result.issue, recovery: result.recovery }
      : {}),
    ...(result.outcome === "cancelled"
      ? { cause: result.cancellation_reason }
      : {}),
    source_revision_id: result.provenance.source_revision_id,
  };
}
