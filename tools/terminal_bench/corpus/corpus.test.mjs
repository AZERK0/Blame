import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseArguments,
  prepareWorkspace,
  readManifest,
} from "./corpus-utils.mjs";
import { scoreRun } from "./score-run.mjs";

test("defines ten unique scored scenarios", async () => {
  const manifest = await readManifest();
  const identifiers = manifest.scenarios.map(({ id }) => id);
  assert.equal(identifiers.length, 10);
  assert.equal(new Set(identifiers).size, 10);
  for (const scenario of manifest.scenarios) {
    assert.ok(scenario.allowedPaths.length > 0);
    assert.ok(scenario.maxIterations > 0);
    assert.ok(scenario.timeoutSeconds > 0);
  }
});

test("accepts the pnpm argument separator", () => {
  const options = parseArguments(["--", "--label", "baseline"]);
  assert.equal(options.get("label"), "baseline");
});

test("materializes and scores an isolated workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "blame-corpus-"));
  try {
    const workspace = join(root, "workspace");
    const runDirectory = join(root, "run");
    const manifest = await readManifest();
    const scenario = manifest.scenarios.find(
      ({ id }) => id === "symbol-function",
    );
    assert.ok(scenario);
    await prepareWorkspace(workspace, scenario.id);
    await mkdir(runDirectory);
    await writeFile(
      join(workspace, "src/project-label.ts"),
      "export function formatProjectLabel(name: string) {\n  return `Project · ${name.trim()}`;\n}\n",
      "utf8",
    );
    await mkdir(join(workspace, ".blame/logs"), { recursive: true });
    await writeFile(join(workspace, ".blame/logs/runtime.log"), "internal\n");
    await writeFile(join(runDirectory, "events.jsonl"), "", {
      encoding: "utf8",
      flag: "a",
    });
    await writeFile(
      join(runDirectory, "result.json"),
      `${JSON.stringify(successfulResult())}\n`,
      { encoding: "utf8", flag: "a" },
    );
    const score = await scoreRun(runDirectory, workspace, scenario);
    assert.equal(score.qualityScore, 100);
    assert.deepEqual(score.changedPaths, ["src/project-label.ts"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function successfulResult() {
  return {
    durationMs: 1_000,
    harness: "blame",
    metrics: {
      editing: { blocked: 0, symbolOperations: 1 },
      navigation: { deduplicatedReads: 0, readCalls: 1, returnedBytes: 100 },
      tools: { calls: 3 },
    },
    status: "succeeded",
    taskId: "symbol-function",
    usage: { aggregateUsage: { totalInputTokens: 100, totalOutputTokens: 10 } },
    verified: true,
  };
}
