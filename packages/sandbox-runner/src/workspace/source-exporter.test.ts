import assert from "node:assert/strict";
import test from "node:test";
import { sameMetadata } from "./source-exporter.js";

const file = { type: "file", sha256: "a".repeat(64), mode: 0o644, size: 4 };

test("treats permission-only and type-only workspace changes as deltas", () => {
  assert.equal(sameMetadata(file, { ...file }), true);
  assert.equal(sameMetadata(file, { ...file, mode: 0o755 }), false);
  assert.equal(sameMetadata(file, { ...file, type: "symlink", target: "target" }), false);
  assert.equal(sameMetadata(undefined, file), false);
});
