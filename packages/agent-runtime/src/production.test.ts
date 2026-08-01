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
