import assert from "node:assert/strict";
import test from "node:test";

import { reasoningConfig } from "./reasoning.js";

test("maps every reasoning selection to a valid Cline config", () => {
  assert.deepEqual(reasoningConfig(undefined), {});
  assert.deepEqual(reasoningConfig("none"), { thinking: false });
  assert.deepEqual(reasoningConfig("enabled"), { thinking: true });
  assert.deepEqual(reasoningConfig("max"), {
    reasoningEffort: "max",
    thinking: true,
  });
});
