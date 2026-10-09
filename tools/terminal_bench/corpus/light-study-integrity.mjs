import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import assert from "node:assert/strict";

const directory = resolve(process.argv[2]);
const json = async (name) => JSON.parse(await readFile(join(directory, name), "utf8"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const results = await json("results.json");
const protocol = await json("protocol.json");
const inventory = await json("inventory.json");
const adjudication = await json("adjudication.json");
assert.equal(results.completed, results.planned);
assert.equal(results.rows.length, results.planned);
assert.equal(new Set(results.rows.map((row) => row.name)).size, results.planned);
assert.equal(sha(await readFile(join(directory, "protocol.json"))), results.provenance.protocolSha256);
assert.deepEqual(results.rows.map(({ id, repetition, arm, condition }) => ({ id, repetition, arm, condition })), results.provenance.order);
for (const artifact of inventory) {
  assert.ok(!artifact.missing, `Missing ${artifact.artifact}`);
  const raw = gunzipSync(await readFile(join(directory, "traces", artifact.artifact)));
  assert.equal(raw.length, artifact.uncompressedBytes);
  assert.equal(sha(raw), artifact.sha256);
}
for (const row of results.rows) {
  const execution = JSON.parse(gunzipSync(await readFile(join(directory, "traces", `${row.name}.result.json.gz`))));
  const task = protocol.tasks.find(({ id }) => id === row.id);
  assert.equal(execution.modelId, protocol.model);
  assert.equal(execution.reasoningEffort, protocol.effort);
  assert.equal(execution.providerId, results.provenance.provider);
  assert.equal(execution.maxIterations, task.maxIterations);
  assert.equal(execution.timeoutMs, task.timeoutSeconds * 1000);
  assert.equal(execution.status, row.status);
  const decision = adjudication.decisions.find((entry) => entry.name === row.name);
  assert.equal(decision?.review, "reviewed");
  assert.equal(row.auditedSuccess, decision.independentSuccess);
  assert.equal(row.auditedCompletion, row.auditedSuccess && row.status === "succeeded");
  for (const [file, key] of [["events.jsonl", "eventsSha256"], ["workspace.diff", "diffSha256"]]) {
    const artifact = inventory.find((entry) => entry.artifact === `${row.name}.${file}.gz`);
    assert.equal(artifact.sha256, row[key]);
    if (decision[key]) assert.equal(artifact.sha256, decision[key]);
  }
}
const observed = results.rows.reduce((sum, row) => sum + row.usage.cost, 0);
const report = { checkedAt: new Date().toISOString(), planned: results.planned,
  completed: results.completed, rawGzipArtifacts: inventory.length, missingArtifacts: 0,
  rawByteSha256Verified: true, frozenOrderModelEffortBudgetsVerified: true,
  reviewedTraces: adjudication.decisions.length,
  observedEstimatedUsd: observed,
  maxTrialObservedEstimatedUsd: Math.max(...results.rows.map((row) => row.usage.cost)),
  configuredBudget: protocol.budget,
  tokensCostReconciledTrials: results.rows.filter((row) => row.usage.tokensCostReconciled).length,
  cacheRequestCompleteTrials: results.rows.filter((row) => row.usage.complete).length,
  automaticRecoveryActivations: results.rows.reduce((sum, row) => sum + row.recoveryNotices, 0),
  processWatchdogTrials: results.rows.filter((row) => row.exit?.watchdog).length,
  resultsSha256: sha(await readFile(join(directory, "results.json"))),
  helperSha256: sha(await readFile(new URL(import.meta.url))),
  accountingLimit: "Observed SDK estimates and event reconciliation do not establish invoice, hidden retry or complete request/cache accounting. Failed and unreconciled trials remain included.",
};
await writeFile(join(directory, "checks.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
