import assert from "node:assert/strict";
import test from "node:test";
import {
  assertHeadlessDevelopment,
  HeadlessConfigurationError,
} from "./dev-guard.js";

test("allows an explicitly enabled development runner", () => {
  assert.doesNotThrow(() =>
    assertHeadlessDevelopment({ BLAME_HEADLESS_DEV: "true" }),
  );
});

test("rejects a packaged or production runner", () => {
  assert.throws(
    () =>
      assertHeadlessDevelopment({
        BLAME_AGENT_PACKAGED: "true",
        BLAME_HEADLESS_DEV: "true",
      }),
    HeadlessConfigurationError,
  );
  assert.throws(
    () =>
      assertHeadlessDevelopment({
        BLAME_HEADLESS_DEV: "true",
        NODE_ENV: "production",
      }),
    HeadlessConfigurationError,
  );
});
