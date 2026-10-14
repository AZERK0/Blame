// Publish unchanged raw evidence only after every completed trial has a SHA-bound review.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";

const campaign = resolve(process.argv[2]);
const destination = resolve(process.argv[3]);
const partition = process.argv[4] ?? "confirmation";
assert.ok(["confirmation", "diagnostic"].includes(partition));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const writeJson = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + "\n");
const analysis = await json(join(campaign, "analysis.json"));
const review = await json(join(campaign, "source-review.json"));
const protocol = await json(join(destination, "protocol.json"));
const lifecycle = await json(join(campaign, "tool-lifecycle-inspection.json"));
const decisions = review.decisions;
assert.equal(new Set(decisions.map(decision => decision.name)).size, analysis.completed);
assert.equal(decisions.length, analysis.completed);
assert.equal(lifecycle.trials.length, analysis.completed);
assert.equal(sha(await readFile(join(destination, "protocol.json"))), analysis.provenance.protocolSha256);
assert.deepEqual(analysis.rows.map(({ repetition, id, arm }) => ({ repetition, id, arm })),
  analysis.provenance.order.slice(0, analysis.completed));
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
  const calls = lifecycle.trials.find(trial => trial.name === row.name);
  assert.equal(calls.eventsSha256, row.eventsSha256);
  if (calls.missingIds.length || calls.startedWithoutFinish.length ||
      calls.finishedWithoutStart.length || calls.differentInputs.length)
    assert.ok(decision.lifecycleAdditionalReview, row.name + ": orphan/changed input needs explicit review");
  let execution;
  try { execution = await json(join(campaign, row.name, "result.json")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (execution) {
    assert.equal(execution.modelId, protocol.model);
    assert.equal(execution.reasoningEffort, protocol.effort);
    assert.equal(execution.providerId, protocol.provider);
    assert.equal(execution.maxIterations, protocol.budgets.maxIterations);
    assert.equal(execution.timeoutMs, protocol.budgets.timeoutSeconds * 1000);
    assert.equal(execution.harness, row.arm === "cline" ? "cline" : "blame");
    assert.equal(execution.status, row.status);
  }
  row.auditedCriteria = row.independentFunctionalSuccess && decision.fullRequestCriteriaPassed &&
    decision.agentRequiredChecksPassed && decision.noSolutionRetrieval;
  row.auditedCompletion = row.auditedCriteria && row.status === "succeeded";
  // Compatibility for the existing paired helper: explicitly require runtime completion.
  row.auditedSuccess = row.auditedCompletion;
  row.partition = protocol.studyKind==="corrected-native-confirmation"
    ? protocol.tasks.find(t=>t.id===row.id).partition : partition;
  row.agentRequiredChecksPassed = decision.agentRequiredChecksPassed;
  row.fullRequestCriteriaPassed = decision.fullRequestCriteriaPassed;
  row.noSolutionRetrieval = decision.noSolutionRetrieval;
}
const summary = { partition:protocol.phaseOrder?"mixed":partition, definition: "Internal real-repository panel, not an external benchmark certification. Official runtime success, frozen independent feature/existing-suite success, actual required agent validation and full audited completion are separate. Post-selected wording sensitivity never replaces the registered endpoint. Cache tokens subset input, reasoning subset output; incomplete usage is never zero-filled.",
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
    agentRequiredChecksPassed: rows.filter((row) => row.agentRequiredChecksPassed).length,
    manuallyReviewedRequestCriteriaPassed: rows.filter((row) => row.fullRequestCriteriaPassed).length,
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
await writeFile(join(destination, "tool-lifecycle-inspection.json"),
  await readFile(join(campaign, "tool-lifecycle-inspection.json")));
if (analysis.completed === analysis.planned && !protocol.continuationOf && !protocol.phaseOrder) {
  execFileSync(process.execPath, [resolve("tools/terminal_bench/corpus/light-study-compare.mjs"), destination],
    { stdio: "ignore" });
} else {
  await writeJson(join(destination, "paired-comparison.json"), {
    reason: protocol.phaseOrder
      ? "Preregistered fresh confirmation and known diagnostics remain separate. See stratum-specific comparisons; do not pool efficacy."
      :protocol.continuationOf
      ? "Administrative single-slot continuation has no contemporaneous counterpart; retain parent and tail separately. Any cross-registration comparison is descriptive and must disclose actual prompt/environment differences."
      : "Registered panel stopped before all planned outcomes; retain unexecuted cases. No complete-panel efficiency claim.",
    comparisons: [] });
}
const integrity = { reviewedTraces: decisions.length, rawArtifacts: inventory.filter((entry) => !entry.missing).length,
  missingArtifacts: inventory.filter((entry) => entry.missing).length, rawByteSha256Verified: true,
  allPlannedRetained: analysis.provenance.order.length === analysis.planned,
  frozenOrderModelEffortBudgetsVerified: true, allRecordedToolInputsReviewed: true,
  planned: analysis.planned, completed: analysis.completed, unexecuted: analysis.planned - analysis.completed,
  observedEstimatedUsd: analysis.rows.reduce((sum, row) => sum + (row.usage.cost ?? 0), 0),
  tokenCostReconciled: analysis.rows.filter((row) => row.usage.tokensCostReconciled).length,
  fullRequestCacheAccounting: analysis.rows.filter((row) => row.usage.complete).length,
  resultsSha256: sha(await readFile(join(destination, "results.json"))),
  limitations: "Manual review covers recorded actions and source only; API estimates are not invoices and hidden retries/cache remain unestablished. No model source repair, reference patch recovery or verifier feedback." };
await writeJson(join(destination, "checks.json"), integrity);
process.stdout.write(JSON.stringify(integrity) + "\n");
