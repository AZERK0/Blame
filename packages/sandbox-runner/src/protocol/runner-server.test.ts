import assert from "node:assert/strict";
import test from "node:test";
import { assertFreshFencingToken } from "./runner-server.js";

test("rejects commands from a stale control-plane worker", () => {
  assert.doesNotThrow(() => assertFreshFencingToken(7, 7));
  assert.doesNotThrow(() => assertFreshFencingToken(7, 8));
  assert.throws(
    () => assertFreshFencingToken(8, 7),
    (error) => (error as { runnerCode?: string }).runnerCode === "STALE_FENCING_TOKEN",
  );
});
