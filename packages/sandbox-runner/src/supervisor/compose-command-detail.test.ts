import assert from "node:assert/strict";
import test from "node:test";
import { composeCommandFailureDetail } from "./compose-command-detail.js";

test("preserves short Compose command output", () => {
  assert.equal(
    composeCommandFailureDetail(" warning \n", " result \n"),
    "warning\nresult",
  );
});

test("preserves the fatal tail after noisy Compose warnings", () => {
  const detail = composeCommandFailureDetail(
    `first warning\n${"repeated warning\n".repeat(100)}`,
    "fatal: container creation failed",
  );

  assert.equal(detail.length, 1_000);
  assert.match(detail, /^first warning/);
  assert.match(detail, /Compose output truncated/);
  assert.match(detail, /fatal: container creation failed$/);
});
