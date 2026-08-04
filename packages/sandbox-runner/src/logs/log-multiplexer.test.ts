import assert from "node:assert/strict";
import test from "node:test";
import { redact } from "./log-multiplexer.js";

test("redacts secrets and URLs before project logs reach persistent storage", () => {
  const value = redact(
    "token=super-secret access_key=credential fetch https://signed.example/path?signature=secret",
  );
  assert.equal(value.includes("super-secret"), false);
  assert.equal(value.includes("signed.example"), false);
  assert.match(value, /token=\[redacted\]/);
  assert.equal(value.includes("credential"), false);
  assert.match(value, /\[redacted-url\]/);
});
