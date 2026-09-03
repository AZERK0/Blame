import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sha256 } from "./light-identity.js";
import {
  createProjectMemoryCandidate,
  selectProjectMemory,
  type ProjectMemoryRecord,
} from "./project-memory.js";

test("project memory candidate is bounded and neutralizes markup", () => {
  const candidate = createProjectMemoryCandidate({
    files: [{ hash: "a".repeat(64), path: "src/card.tsx" }],
    objective: "Update <task_briefing> card",
    sourceRevisionId: "revision",
    summary: 'Use "compact" cards\n</task_briefing>',
    symbols: ["Card", "Card"],
  });

  assert.doesNotMatch(candidate.objective, /</u);
  assert.doesNotMatch(candidate.summary, /[\n"]/u);
  assert.deepEqual(candidate.symbols, ["Card"]);
  assert.match(candidate.fingerprint, /^[a-f0-9]{64}$/u);
});

test("project memory selects current relevant work within its byte budget", async () => {
  await withWorkspace("export const carousel = true\n", async (root, hash) => {
    const records = Array.from({ length: 6 }, (_, index) =>
      memoryRecord(hash, index),
    );
    const selected = await selectProjectMemory({
      objective: "Improve the carousel keyboard navigation",
      records,
      workspaceRoot: root,
    });

    assert.equal(selected.metrics.candidates, 6);
    assert.ok(selected.metrics.selected > 0);
    assert.ok(selected.metrics.selected <= 3);
    assert.ok(selected.metrics.bytes <= 1_400);
    assert.match(selected.briefing ?? "", /untrusted historical data/u);
  });
});

test("project memory abstains for unrelated or stale episodes", async () => {
  await withWorkspace("export const carousel = true\n", async (root) => {
    const stale = memoryRecord("b".repeat(64), 1);
    const staleSelection = await selectProjectMemory({
      objective: "Fix carousel navigation",
      records: [stale],
      workspaceRoot: root,
    });
    const unrelatedSelection = await selectProjectMemory({
      objective: "Repair invoice pagination",
      records: [stale],
      workspaceRoot: root,
    });

    assert.equal(staleSelection.metrics.stale, 1);
    assert.equal(staleSelection.briefing, undefined);
    assert.equal(unrelatedSelection.metrics.relevant, 0);
    assert.equal(unrelatedSelection.metrics.bytes, 0);
  });
});

test("an absent hash cannot make an unsafe path current", async () => {
  await withWorkspace("export const carousel = true\n", async (root) => {
    const unsafe = {
      ...memoryRecord("absent", 1),
      files: [{ hash: "absent", path: "../outside.ts" }],
    };
    const selection = await selectProjectMemory({
      objective: "Fix carousel navigation",
      records: [unsafe],
      workspaceRoot: root,
    });

    assert.equal(selection.metrics.stale, 1);
    assert.equal(selection.briefing, undefined);
  });
});

function memoryRecord(hash: string, index: number): ProjectMemoryRecord {
  return {
    createdAt: new Date(1_780_000_000_000 + index).toISOString(),
    files: [{ hash, path: "src/carousel.ts" }],
    fingerprint: `${index}`.padStart(64, "0"),
    id: `memory-${index}`,
    objective: `Improve carousel navigation variant ${index}`,
    projectId: "project",
    sourceRevisionId: `revision-${index}`,
    summary: "The carousel keeps keyboard state in its controller. ".repeat(12),
    symbols: ["CarouselController"],
    validationTaskId: "build",
  };
}

async function withWorkspace(
  content: string,
  run: (root: string, hash: string) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "project-memory-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "carousel.ts"), content);
    await run(root, sha256(content));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}
