import assert from "node:assert/strict";
import test from "node:test";

import { appendProductionConfig, blameCompactionConfig, loadProductionConfig } from "./production.js";

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

test("per-request output limits are explicit and cannot silently accept invalid bounds", () => {
  assert.equal(loadProductionConfig({}).requestMaxOutputTokens, undefined);
  assert.equal(loadProductionConfig({ BLAME_AGENT_REQUEST_MAX_OUTPUT_TOKENS: "8192" }).requestMaxOutputTokens, 8192);
  for (const value of ["0", "-1", "1.5", "", "NaN", "Infinity", "9007199254740992"])
    assert.throws(() => loadProductionConfig({ BLAME_AGENT_REQUEST_MAX_OUTPUT_TOKENS: value }), /positive integer/u);
});

test("the same SDK model configuration caps each request without raising a lower caller limit", () => {
  const config = { providerId: "openai-codex", modelId: "gpt-5.6-luna", maxTokensPerTurn: 128_000 };
  assert.equal(appendProductionConfig(config, { requestMaxOutputTokens: 8192 }).maxTokensPerTurn, 8192);
  assert.equal(appendProductionConfig({ ...config, maxTokensPerTurn: 512 }, { requestMaxOutputTokens: 8192 }).maxTokensPerTurn, 512);
  assert.equal(appendProductionConfig(config, {}).maxTokensPerTurn, 128_000);
});
