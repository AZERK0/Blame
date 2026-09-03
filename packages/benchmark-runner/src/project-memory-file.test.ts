import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProjectMemoryFile } from "./project-memory-file.js";

test("project memory file stores project-scoped records idempotently", async () => {
  const directory = await mkdtemp(join(tmpdir(), "benchmark-memory-"));
  const store = new ProjectMemoryFile(join(directory, "memory.json"));
  const candidate = {
    files: [{ hash: "a".repeat(64), path: "src/value.ts" }],
    fingerprint: "b".repeat(64),
    objective: "Update value",
    sourceRevisionId: "revision",
    summary: "Updated the shared value.",
    symbols: ["value"],
  };
  try {
    const first = await store.save({}, "project-a", candidate);
    const repeated = await store.save({}, "project-a", candidate);
    await store.save({}, "project-b", candidate);

    assert.equal(first.id, repeated.id);
    assert.equal((await store.list({}, "project-a")).length, 1);
    assert.equal((await store.list({}, "project-b")).length, 1);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
