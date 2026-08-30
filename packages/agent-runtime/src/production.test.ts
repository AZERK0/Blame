import assert from "node:assert/strict";
import test from "node:test";

import { blameCompactionConfig, loadProductionConfig } from "./production.js";

test("uses Cline agentic compaction by default", () => {
  assert.deepEqual(blameCompactionConfig({}), {
    enabled: true,
    strategy: "agentic",
  });
});

test("keeps supported Cline compaction overrides", () => {
  assert.deepEqual(
    blameCompactionConfig({
      compactionEnabled: false,
      compactionPreserveRecentTokens: 12_000,
      compactionStrategy: "basic",
    }),
    {
      enabled: false,
      preserveRecentTokens: 12_000,
      strategy: "basic",
    },
  );
});

test("normalizes the production compaction strategy", () => {
  assert.equal(
    loadProductionConfig({ BLAME_AGENT_COMPACTION_STRATEGY: "basic" })
      .compactionStrategy,
    "basic",
  );
  assert.equal(
    loadProductionConfig({ BLAME_AGENT_COMPACTION_STRATEGY: "legacy" })
      .compactionStrategy,
    "agentic",
  );
});

test("uses continuity-preserving bounded compaction ratios", () => {
  const defaults = loadProductionConfig({});
  assert.equal(defaults.compactionWarningRatio, 0.55);
  assert.equal(defaults.compactionTriggerRatio, 0.7);
  assert.equal(defaults.compactionTargetRatio, 0.4);
  assert.equal(defaults.compactionOverflowTargetRatio, 0.35);
  const configured = loadProductionConfig({
    BLAME_AGENT_COMPACTION_WARNING_RATIO: "0.6",
    BLAME_AGENT_COMPACTION_TRIGGER_RATIO: "0.7",
  });
  assert.equal(configured.compactionWarningRatio, 0.6);
  assert.equal(configured.compactionTriggerRatio, 0.7);
  assert.equal(
    loadProductionConfig({ BLAME_AGENT_COMPACTION_TRIGGER_RATIO: "0.95" })
      .compactionTriggerRatio,
    0.7,
  );
});
