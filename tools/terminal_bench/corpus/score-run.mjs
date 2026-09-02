import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { changedPaths } from "./corpus-utils.mjs";
import { scenarioChecks } from "./scenario-checks.mjs";

export async function scoreRun(runDirectory, workspace, scenario) {
  const result = await readJson(join(runDirectory, "result.json"));
  const events = await readEvents(join(runDirectory, "events.jsonl"));
  const checks = await scenarioChecks(scenario.id, workspace, result, events);
  const paths = changedPaths(workspace).filter(
    (path) => path !== "node_modules",
  );
  const unexpectedPaths = paths.filter(
    (path) => !scenario.allowedPaths.includes(path),
  );
  const validationPassed = validateTypes(workspace);
  const functionalScore = ratioScore(checks, 70);
  const qualityScore =
    functionalScore +
    (validationPassed ? 15 : 0) +
    (unexpectedPaths.length ? 0 : 10) +
    (result.status === "succeeded" ? 5 : 0);
  const score = runScore(
    result,
    checks,
    paths,
    unexpectedPaths,
    validationPassed,
    functionalScore,
    qualityScore,
  );
  await writeFile(
    join(runDirectory, "score.json"),
    `${JSON.stringify(score, null, 2)}\n`,
    "utf8",
  );
  return score;
}

function runScore(
  result,
  checks,
  paths,
  unexpectedPaths,
  validationPassed,
  functionalScore,
  qualityScore,
) {
  return {
    scenario: result.taskId,
    harness: result.harness,
    qualityScore,
    functionalScore,
    checks,
    validationPassed,
    changedPaths: paths,
    unexpectedPaths,
    status: result.status,
    verified: result.verified,
    durationMs: result.durationMs,
    tokens: usageMetrics(result.usage),
    metrics: result.metrics,
  };
}

function usageMetrics(usage) {
  const value = usage?.aggregateUsage ?? usage?.usage ?? usage ?? {};
  return {
    input: value.totalInputTokens ?? value.inputTokens ?? 0,
    output: value.totalOutputTokens ?? value.outputTokens ?? 0,
    cacheRead: value.totalCacheReadTokens ?? value.cacheReadTokens ?? 0,
    cacheWrite: value.totalCacheWriteTokens ?? value.cacheWriteTokens ?? 0,
    cost: value.totalCost ?? value.cost ?? 0,
  };
}

function validateTypes(workspace) {
  const executable = join(workspace, "node_modules/.bin/tsc");
  const result = spawnSync(executable, ["--noEmit"], {
    cwd: workspace,
    encoding: "utf8",
  });
  return result.status === 0;
}

function ratioScore(checks, maximum) {
  if (!checks.length) return maximum;
  const passed = checks.filter((entry) => entry.passed).length;
  return Math.round((passed / checks.length) * maximum);
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return {
      durationMs: 0,
      harness: "unknown",
      metrics: {},
      status: "failed",
      taskId: "unknown",
    };
  }
}

async function readEvents(path) {
  try {
    const content = await readFile(path, "utf8");
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}
