// Verify saved evidence and reconcile dispatch, reporting and paired cohorts.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { studyFor } from "./campaign-paths.mjs";
assert.equal(process.env.BLAME_STUDY_VARIANT, "declarations-eur1");
const study = studyFor("f24"), json = async path => JSON.parse(await readFile(join(study, path), "utf8"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const protocol = await json("protocol.json"), results = await json("results.json"), summary = await json("multifile-summary.json");
const inventory = await json("wire-inventory.json"), bytes = await readFile(join(study, inventory.artifact));
assert.equal(sha(bytes), inventory.sha256);
const wire = JSON.parse(gunzipSync(bytes));
let requests = 0;
const observedContracts = {};
for (const trial of wire.trials) {
  assert(!trial.missing);
  assert.equal(sha(trial.requests.map(r => JSON.stringify(r) + "\n").join("")), trial.metadataSha256);
  for (const artifact of trial.artifacts) assert.equal(sha(JSON.stringify(wire.contracts[artifact.file]) + "\n"), artifact.sha256);
  const cline = trial.name.endsWith("-cline");
  for (const r of trial.requests) {
    requests++; assert.equal(r.model, protocol.model); assert.equal(r.reasoning.effort, protocol.effort);
    assert.equal(r.byteLimit, protocol.budgets.maximumSerializedRequestBytes);
    assert.equal(r.budgetRejected, r.requestBytes > r.byteLimit);
    for (const [kind, hash] of [["schema", r.toolsSha256], ["prompt", r.promptSha256]])
      assert.equal(sha(JSON.stringify(wire.contracts[kind + "-" + hash + ".json"])), hash);
    const schema = wire.contracts["schema-" + r.toolsSha256 + ".json"], names = schema.map(t => t.name ?? t.function?.name).sort();
    assert.deepEqual(names, (cline ? ["read_files", "search_codebase", "run_commands", "fetch_web_content", "apply_patch"]
      : ["skills", "fetch_web_content", "search_code", "read_code", "edit_code", "run_task", "finish_task"]).sort());
    observedContracts[cline ? "cline" : "light"] = names;
  }
}
assert.equal(requests, inventory.requests);
assert.equal(results.planned, 18); assert.equal(results.completed, 18);
assert.equal(results.rows.length, 18); assert(results.rows.every(r => r.officialRuntimeSuccess && r.independentFunctionalSuccess));
assert(results.rows.every(r => r.agentRequiredChecksPassed && r.noSolutionRetrieval && r.usage.tokensCostReconciled));
assert.equal(summary.missingWireResponseUsage, 0);
assert(summary.totalAccountedUsd <= summary.operationalCeilingUsd);
assert.equal(summary.priorObservedOrReservedUsd, .408056);
assert.equal(summary.newCampaignAccounting.reservedUsd, 0);
const review = await json("source-review.json"), reporting = review.decisions.filter(d => !d.fullRequestCriteriaPassed);
assert.equal(reporting.length, 5); assert(reporting.every(d => d.name.endsWith("-cline")));
const queries = await json("ranking-query-replay.json");
assert.equal(queries.paidRequests, 0); assert.equal(queries.eligibleQueries, 4);
assert.equal(queries.changedResponses, 0); assert(queries.rows.every(r => r.equalResponses));
const mechanisms = await json("multifile-mechanisms.json");
assert.equal(mechanisms.rows.length, 18);
assert.equal(mechanisms.rows.filter(r => !r.name.endsWith("-cline")).reduce((n, r) => n + r.compilerRenameCalls, 0), 12);
assert(mechanisms.rows.filter(r => !r.name.endsWith("-cline")).every(r => r.admittedCompletion === "unverified"));
assert.equal(mechanisms.rows.filter(r => r.name.endsWith("-cline") && r.fullSuiteCalls === 2).length, 5);
const check = { rawArtifactsVerifiedSeparately: 108, journalsVerifiedSeparately: 18, wireRecordsVerified: requests,
  observedContracts, allAssignmentsRetained: true, modelAndEffortVerified: true, registeredByteGuardVerified: true,
  officialAndFunctionalSuccess: 18, executedRequestedChecks: 18, strictReportingFailures: 5,
  strictReportingFailureNames: reporting.map(r => r.name), paidTrialRetries: 0,
  originalMissingResponseReserveRetainedUsd: .23, newWireConsumptionCountGaps: 0,
  sameSourceQueryCounterfactuals: 4, changedRankingResponses: 0,
  schemaOutputLimitPresent: inventory.wireOutputLimitPresent,
  fullCacheAccountingUnavailable: 18, sourceMatchedSecondaryResourcePairs: 6, strictCurrentNativePairs: 1,
  limitation: "Manual source/input review is unblinded; caller-requested active counts exclude skipped bodies. Strict report interpretation and full functional-source comparison are both retained. Replays diagnose recorded queries, not fresh model confirmation. Public metadata cannot reconstruct private request bodies or verify invoices/hidden retries." };
await writeFile(join(study, "evidence-checks.json"), JSON.stringify(check, null, 2) + "\n");
console.log(JSON.stringify(check));
