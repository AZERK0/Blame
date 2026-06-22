import assert from "node:assert/strict";
import test from "node:test";

import { contextCompressionConfig } from "./context-compression.js";

test("keeps Cline compaction as the default context mode", () => {
  const config = contextCompressionConfig({}, undefined);

  assert.equal(config.enabled, true);
  assert.equal(config.strategy, "basic");
  assert.equal(config.compact, undefined);
});

test("disables compaction for off context mode", () => {
  const config = contextCompressionConfig({}, "off");

  assert.equal(config.enabled, false);
  assert.equal(config.compact, undefined);
});

test("uses Headroom as the only compaction implementation", () => {
  const config = contextCompressionConfig({}, "headroom");

  assert.equal(config.enabled, true);
  assert.equal(config.strategy, undefined);
  assert.equal(typeof config.compact, "function");
});
