// Publish unchanged raw evidence only after every completed trial has a SHA-bound review.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";

const campaign = resolve(process.argv[2]);
const destination = resolve(process.argv[3]);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const writeJson = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + "\n");
const analysis = await json(join(campaign, "analysis.json"));
const review = await json(join(campaign, "source-review.json"));
const decisions = review.decisions;
for (const row of analysis.rows) {
  const decision = decisions.find((decision) => decision.name === row.name);
  assert.equal(decision?.review, "reviewed", row.name);
  for (const [file, field] of [["events.jsonl", "eventsSha256"], ["workspace.diff", "diffSha256"],
    ["score.json", "scoreSha256"]]) {
    const digest = sha(await readFile(join(campaign, row.name, file)));
    assert.equal(digest, row[field]); assert.equal(digest, decision[field]);
  }
  assert.equal(typeof decision.agentRequiredChecksPassed, "boolean");
  assert.equal(typeof decision.noSolutionRetrieval, "boolean");
  assert.equal(typeof decision.fullRequestCriteriaPassed, "boolean");
  row.auditedCriteria = row.independentFunctionalSuccess && decision.fullRequestCriteriaPassed &&
    decision.agentRequiredChecksPassed && decision.noSolutionRetrieval;
  row.auditedCompletion = row.auditedCriteria && row.status === "succeeded";
  // Compatibility for the existing paired helper: explicitly require runtime completion.
  row.auditedSuccess = row.auditedCompletion;
  row.partition = "confirmation";
}
const summary = { definition: "Internal newly authored real-repository panel, not an external benchmark certification. Official runtime success, independent feature/existing-suite success, actual required agent validation and full audited completion are separate. Cache tokens subset input, reasoning subset output; incomplete usage is never zero-filled.",
  planned: analysis.planned, completed: analysis.completed, unexecuted: analysis.planned - analysis.completed, arms: {} };
for (const arm of ["baseline", "modified", "cline"]) {
  const rows = analysis.rows.filter((row) => row.arm === arm);
  const totals = {};
  for (const field of ["input", "output", "cacheRead", "cacheWrite", "cost"]) totals[field] = {
    observed: rows.reduce((sum, row) => sum + (row.usage[field] ?? 0), 0),
    missingAggregates: rows.filter((row) => row.usage[field] === null).length,
    incompleteTrialAccounting: rows.filter((row) => !row.usage.tokensCostReconciled).length,
  };
  summary.arms[arm] = { trials: rows.length, planned: analysis.provenance.order.filter((trial) => trial.arm === arm).length,
    officialRuntimeSuccess: rows.filter((row) => row.officialRuntimeSuccess).length,
    independentFunctionalSuccess: rows.filter((row) => row.independentFunctionalSuccess).length,
    auditedCriteria: rows.filter((row) => row.auditedCriteria).length,
    auditedCompletion: rows.filter((row) => row.auditedCompletion).length,
    timeouts: rows.filter((row) => row.status === "timed_out").length,
    failed: rows.filter((row) => row.status === "failed").length,
    missingResult: rows.filter((row) => row.status === "missing").length,
    watchdogs: rows.filter((row) => row.exit.watchdog).length,
    tokensCostReconciled: rows.filter((row) => row.usage.tokensCostReconciled).length,
    fullRequestCacheAccounting: rows.filter((row) => row.usage.complete).length,
    runnerSeconds: rows.reduce((sum, row) => sum + (row.durationMs ?? 0), 0) / 1000,
    outerAgentSeconds: rows.reduce((sum, row) => sum + row.outerAgentMs, 0) / 1000,
    preparationSeconds: rows.reduce((sum, row) => sum + row.preparationMs, 0) / 1000,
    verificationSeconds: rows.reduce((sum, row) => sum + row.verificationMs, 0) / 1000,
    ...totals };
}
await mkdir(join(destination, "traces"), { recursive: true });
const inventory = [];
for (const row of analysis.rows) {
  for (const file of ["instruction.txt", "events.jsonl", "result.json", "workspace.diff", "trial.json", "score.json"]) {
    const path = join(campaign, row.name, file);
    let bytes;
    try { bytes = await readFile(path); }
    catch (error) { if (error.code !== "ENOENT") throw error; inventory.push({ trial: row.name, file, missing: true }); continue; }
    const artifact = "traces/" + row.name + "." + file + ".gz";
    const compressed = gzipSync(bytes, { mtime: 0 });
    assert.equal(sha(gunzipSync(compressed)), sha(bytes));
    await writeFile(join(destination, artifact), compressed);
    inventory.push({ trial: row.name, file, artifact, bytes: bytes.length, sha256: sha(bytes) });
  }
}
await writeJson(join(destination, "results.json"), analysis);
await writeJson(join(destination, "summary.json"), summary);
await writeJson(join(destination, "source-review.json"), review);
await writeJson(join(destination, "inventory.json"), inventory);
await writeFile(join(destination, "tool-ledger.json"), await readFile(join(campaign, "tool-ledger.json")));
if (analysis.completed === analysis.planned) {
  execFileSync(process.execPath, [resolve("tools/terminal_bench/corpus/light-study-compare.mjs"), destination],
    { stdio: "ignore" });
} else {
  await writeJson(join(destination, "paired-comparison.json"), {
    reason: "Registered panel stopped before all planned outcomes; retain unexecuted cases. No complete-panel efficiency claim.",
    comparisons: [] });
}
const integrity = { reviewedTraces: decisions.length, rawArtifacts: inventory.filter((entry) => !entry.missing).length,
  missingArtifacts: inventory.filter((entry) => entry.missing).length, rawByteSha256Verified: true,
  allPlannedRetained: analysis.provenance.order.length === analysis.planned,
  planned: analysis.planned, completed: analysis.completed, unexecuted: analysis.planned - analysis.completed,
  observedEstimatedUsd: analysis.rows.reduce((sum, row) => sum + (row.usage.cost ?? 0), 0),
  tokenCostReconciled: analysis.rows.filter((row) => row.usage.tokensCostReconciled).length,
  fullRequestCacheAccounting: analysis.rows.filter((row) => row.usage.complete).length,
  resultsSha256: sha(await readFile(join(destination, "results.json"))),
  limitations: "Manual review covers recorded actions and source only; API estimates are not invoices and hidden retries/cache remain unestablished. No model source repair, reference patch recovery or verifier feedback." };
await writeJson(join(destination, "checks.json"), integrity);
process.stdout.write(JSON.stringify(integrity) + "\n");
