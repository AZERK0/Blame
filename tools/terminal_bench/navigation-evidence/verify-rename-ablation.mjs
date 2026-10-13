// Verify saved evidence and isolation, never require a favorable outcome.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { repo, studyFor } from "./campaign-paths.mjs";
assert.equal(process.env.BLAME_STUDY_VARIANT, "rename-ablation");
const study = studyFor("f25"), json = async path => JSON.parse(await readFile(path));
const sha = b => createHash("sha256").update(b).digest("hex");
const protocol = await json(join(study, "protocol.json")), results = await json(join(study, "results.json"));
const summary = await json(join(study, "rename-ablation-summary.json"));
const bindings = await json(join(study, "execution-bindings.json"));
assert.equal(protocol.studyKind, "compiler-rename-ablation");
assert.deepEqual(protocol.tasks, (await json(join(repo, protocol.artifactReuse.priorProtocol))).tasks);
assert.equal(sha(await readFile(join(repo, protocol.artifactReuse.priorProtocol))), protocol.artifactReuse.sha256);
assert.equal(results.provenance.protocolSha256, sha(await readFile(join(study, "protocol.json"))));
assert.deepEqual(results.provenance.frozen, bindings);
assert.equal(results.planned, protocol.tasks.length * protocol.repetitions * protocol.arms.length);
assert.equal(results.rows.length, results.completed);
assert.equal(summary.completed, results.completed);
assert.equal(summary.unexecuted, results.planned - results.completed);
const patchSha = sha(await readFile(join(study, "disable-compiler-rename.patch")));
for (const arm of ["baseline", "modified"]) {
  const source = bindings.versions[arm].source.sourceOverride;
  assert.equal(source.baseCommit, protocol.baseCommit);
  assert.equal(source.patchSha256, patchSha);
  assert.equal(source.appliedPatch, arm === "baseline");
}
assert.equal(bindings.versions.baseline.runner, bindings.versions.modified.runner);
const isolation = await json(join(study, "freeze-isolation.json"));
assert.deepEqual(isolation.differentFiles, ["harness/light-edit.d.ts.map", "harness/light-edit.js"]);
const inventory = await json(join(study, "wire-inventory.json"));
const wireBytes = await readFile(join(study, inventory.artifact));
assert.equal(sha(wireBytes), inventory.sha256);
const wire = JSON.parse(gunzipSync(wireBytes));
const contracts = Object.fromEntries(["baseline", "modified"].map(arm => [arm, { tools: new Set(), prompts: new Set() }]));
let attempts = 0, missingUsage = 0, ineffectiveOutputLimits = 0;
for (const row of results.rows) {
  assert.equal(row.partition, "diagnostic");
  const trial = wire.trials.find(t => t.name === row.name);
  if (trial.missing) continue;
  for (const request of trial.requests) {
    assert.equal(request.model, protocol.model);
    assert.equal(request.reasoning.effort, protocol.effort);
    assert.equal(request.byteLimit, protocol.budgets.maximumSerializedRequestBytes);
    if (!request.budgetRejected) {
      attempts++; assert(request.requestBytes <= request.byteLimit);
      if (request.maximumOutputTokens === null) ineffectiveOutputLimits++;
    }
    if (contracts[row.arm]) {
      contracts[row.arm].tools.add(request.toolsSha256); contracts[row.arm].prompts.add(request.promptSha256);
    }
  }
  missingUsage += Math.max(0, trial.requests.filter(r => !r.budgetRejected).length - row.usage.perRequest.length);
  if (row.arm === "baseline") assert.equal(row.semanticRenameCalls, 0);
  const scoreArtifact = join(study, "traces", row.name + ".score.json.gz");
  const scoreBytes = gunzipSync(await readFile(scoreArtifact)); assert.equal(sha(scoreBytes), row.scoreSha256);
  assert.equal(JSON.parse(scoreBytes).independentFunctionalSuccess, row.independentFunctionalSuccess);
}
for (const field of ["tools", "prompts"]) assert.deepEqual([...contracts.baseline[field]].sort(), [...contracts.modified[field]].sort());
assert.equal(attempts, inventory.requests - inventory.budgetRejected);
assert.equal(missingUsage, summary.missingWireResponseUsage);
assert(summary.totalAccountedUsd <= protocol.budgets.sharedStudyObservedCostStopUsd);
assert.equal(summary.totalAccountedUsd, summary.priorObservedOrReservedUsd + summary.newCampaignAccounting.accountedUsd);
const output = { protocolTaskBindingsVerified: true, archivedRawScoreHashesVerified: true,
  identicalObservedLightSchemasPrompts: true, savedIsolationVerified: true, priorCostsNotEfficacy: true,
  planned: results.planned, completed: results.completed, unexecuted: summary.unexecuted,
  forwardedAttempts: attempts, missingResponseUsage: missingUsage, omittedWireOutputLimits: ineffectiveOutputLimits,
  accountedUsd: summary.totalAccountedUsd, limitation: "Integrity and recorded isolation only; no required success, favorable resource result, invoice equality or generalization claim." };
await writeFile(join(study, "ablation-evidence-checks.json"), JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify(output));
