import assert from "node:assert/strict";
import test from "node:test";
import { PreviewRecoveryCircuit } from "./preview-recovery-circuit.ts";

test("backs off repeated preview failures until configuration changes", () => {
  const circuit = new PreviewRecoveryCircuit([5_000, 30_000]);
  circuit.failed("story", "config-a", "failure-a", 1_000);
  assert.deepEqual(circuit.decision("story", "config-a", 2_000), {
    allowed: false,
    retryAfterMs: 4_000,
  });
  assert.equal(circuit.decision("story", "config-a", 6_000).allowed, true);
  circuit.failed("story", "config-a", "failure-a", 6_000);
  assert.equal(
    circuit.decision("story", "config-a", 10_000).retryAfterMs,
    26_000,
  );
  assert.equal(circuit.decision("story", "config-b", 10_000).allowed, true);
  circuit.reset("story");
  assert.equal(circuit.decision("story", "config-a", 10_000).allowed, true);
});
