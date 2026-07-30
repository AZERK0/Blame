import assert from "node:assert/strict";
import test from "node:test";

import {
  isBaseRuntimeProvider,
  listClineProviders,
} from "./provider-catalog.js";

test("excludes providers that require external CLI authentication", async () => {
  assert.equal(isBaseRuntimeProvider("openai-codex-cli"), false);
  assert.equal(isBaseRuntimeProvider("claude-code"), false);
  assert.equal(isBaseRuntimeProvider("openai-codex"), true);
  assert.equal(isBaseRuntimeProvider("anthropic"), true);

  const providers = await listClineProviders();
  const providerIds = new Set(providers.map((provider) => provider.id));

  assert.equal(providerIds.has("openai-codex-cli"), false);
  assert.equal(providerIds.has("claude-code"), false);
  assert.equal(providerIds.has("openai-codex"), true);
  assert.equal(providerIds.has("anthropic"), true);
  const codex = providers.find((provider) => provider.id === "openai-codex");
  assert.equal(codex?.models["gpt-5.6-sol"]?.name, "GPT-5.6 Sol");
});
