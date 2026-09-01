import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeValue } from "./event-recorder.js";

test("removes raw provider data and redacts credentials", () => {
  const sanitized = sanitizeValue({
    nested: { apiKey: "secret", raw: { request: "private" } },
    token: "secret",
  });
  assert.deepEqual(sanitized, {
    nested: { apiKey: "[REDACTED]" },
    token: "[REDACTED]",
  });
});
