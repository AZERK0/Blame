// Keep the incomplete primary registration and administrative tail separate.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { repo } from "./campaign-paths.mjs";
import { reserveTrialCosts } from "./budget-accounting.mjs";
const dir = suffix => join(repo, `docs/experiments/light-harness-navigation-evidence-f25-2026-10-13-${suffix}`);
const parent = dir("rename-ablation"), tail = dir("rename-tail"), json = async path => JSON.parse(await readFile(path));
const [p, t, pr, tr, pb, tb, ps] = await Promise.all([
  json(join(parent, "protocol.json")), json(join(tail, "protocol.json")),
  json(join(parent, "results.json")), json(join(tail, "results.json")),
  json(join(parent, "execution-bindings.json")), json(join(tail, "execution-bindings.json")),
  json(join(parent, "rename-ablation-summary.json")),
]);
assert.equal(pr.completed, 11); assert.equal(pr.planned, 12); assert.equal(tr.completed, 1); assert.equal(tr.planned, 1);
const b = tr.rows[0], a = pr.rows.find(r => r.id === b.id && r.repetition === b.repetition && r.arm === "modified");
assert(!pr.rows.some(r => r.name === b.name), "No dispatched parent slot retried");
assert.deepEqual(t.tasks[0], p.tasks.find(task => task.id === b.id));
for (const arm of ["baseline", "modified"]) {
  assert.equal(pb.versions[arm].runtime, tb.versions[arm].runtime);
  assert.equal(pb.versions[arm].runner, tb.versions[arm].runner);
  assert.deepEqual(pb.versions[arm].source.sourceOverride, tb.versions[arm].source.sourceOverride);
}
for (const key of ["model", "effort", "provider", "apiUrl", "baseCommit"]) assert.equal(p[key], t[key]);
for (const key of Object.keys(p.budgets).filter(k => !["sharedStudyObservedCostStopUsd", "panelObservedCostStopUsd"].includes(k)))
  assert.equal(p.budgets[key], t.budgets[key]);
const parentWire = JSON.parse(gunzipSync(await readFile(join(parent, "wire-contracts.json.gz"))));
const tailWire = JSON.parse(gunzipSync(await readFile(join(tail, "wire-contracts.json.gz"))));
const pa = parentWire.trials.find(r => r.name === a.name), bt = tailWire.trials[0];
const prompt = (wire, row, variant) => wire.contracts["prompt-" + row.requests[0].promptSha256 + ".json"]
  .replaceAll(join(repo, `.blame/research/navigation-evidence-${variant}/f25`, row.name, "workspace"), "<WORKSPACE>");
const ap = prompt(parentWire, pa, "rename-ablation"), bp = prompt(tailWire, bt, "rename-tail");
const gitHeadPattern = /("latestGitCommitHash": ")[a-f0-9]{40}("\s*,)/gu;
assert.notEqual(ap, bp, "Preserve actual prompt difference, never silently normalize it away");
assert.equal(ap.replace(gitHeadPattern, "$1<GIT_HEAD>$2"), bp.replace(gitHeadPattern, "$1<GIT_HEAD>$2"));
assert.equal(pa.requests[0].toolsSha256, bt.requests[0].toolsSha256);
const scores = await Promise.all([[parent, a], [tail, b]].map(async ([root, row]) =>
  JSON.parse(gunzipSync(await readFile(join(root, "traces", row.name + ".score.json.gz"))))));
assert.deepEqual(scores[0].sourceSha256, scores[1].sourceSha256);
const matched = r => r.auditedCompletion && r.usage.tokensCostReconciled;
const metrics = { tokens: r => r.usage.input + r.usage.output, estimatedUsd: r => r.usage.cost, runnerSeconds: r => r.durationMs / 1000 };
const compare = pairs => Object.fromEntries(Object.entries(metrics).map(([key, value]) => {
  const left = pairs.reduce((n, [x]) => n + value(x), 0), right = pairs.reduce((n, [, y]) => n + value(y), 0);
  return [key, { left, right, relativeChange: right ? left / right - 1 : null }];
}));
const primaryPairs = pr.rows.filter(r => r.arm === "modified" && matched(r)).map(x => [x,
  pr.rows.find(y => y.arm === "baseline" && y.id === x.id && y.repetition === x.repetition && matched(y))]).filter(pair => pair[1]);
const extraPair = matched(a) && matched(b) ? [[a, b]] : [];
assert.equal(primaryPairs.length, 3);
const accounting = reserveTrialCosts(tr.rows, { [b.name]: bt.requests }, t.budgets);
const prior = await json(join(repo, ".blame/research/navigation-evidence-rename-tail/f25/shared-budget-accounting.json"));
const totalAccountedUsd = prior.priorObservedCost + accounting.accountedUsd;
assert(totalAccountedUsd <= t.budgets.sharedStudyObservedCostStopUsd);
const summary = { method: "Original11/12 registration plus one separately registered budget-tail slot. No paid retry or fresh holdout. Primary causal diagnostic uses only the three matched pairs in the original registration; preserve the final slot as exploratory because actual prompt Git HEAD metadata changed with registration time. Do not present four cleanly isolated pairs.",
  parent: { planned: pr.planned, completed: pr.completed, unexecuted: 1, primaryPairs: primaryPairs.length,
    resources: compare(primaryPairs), nativeComparisons: ps.comparisons.filter(c => c.left === "modified" && c.right === "cline") },
  continuation: { planned: 1, completed: 1, name: b.name, official: b.officialRuntimeSuccess,
    functional: b.independentFunctionalSuccess, strict: b.auditedCompletion, accounting,
    descriptivePair: { matched: extraPair.length, resources: compare(extraPair) },
    parentInitialGitHead: ap.match(/"latestGitCommitHash": "([a-f0-9]{40})"/u)[1],
    tailInitialGitHead: bp.match(/"latestGitCommitHash": "([a-f0-9]{40})"/u)[1],
    sameFinalScoredSources: true, sameFrozenRuntimeSchemasPerInvocationBudgets: true,
    actualWorkspaceNormalizedPromptEqual: false, promptDifferenceOnlyGitHead: true,
    reason: "The original prepare helper used registration UTC as GIT_AUTHOR_DATE/GIT_COMMITTER_DATE. Tracked input tree is unchanged, but its commit hash and early prompt metadata differ. This can affect tokenization/cache; do not infer a clean compiler effect for this cross-registration pair." },
  administrativeMatrixSensitivity: { primaryPairs: 3, exploratoryExtraPairs: extraPair.length,
    uniqueCompletedAssignments: pr.completed + tr.completed, resources: compare([...primaryPairs, ...extraPair]),
    limitation: "Descriptive completion of preselected slots across two registrations, including a prompt-metadata confound; not the primary isolated-mechanism result, not a complete single-registration experiment, not fresh confirmation." },
  financial: { newParentEstimatedUsd: ps.newCampaignAccounting.observedUsd, newTailEstimatedUsd: accounting.observedUsd,
    totalAccountedUsd, oldMissingResponseReserveUsd: 0.23,
    referenceEquivalentEur: totalAccountedUsd / t.budgetAmendment.referenceFx.usdPerEur,
    operationalCeilingUsd: t.budgets.sharedStudyObservedCostStopUsd, authorizedCeilingEur: 1, invoiceVerified: false },
  wire: { forwardedAttempts: bt.requests.filter(r => !r.budgetRejected).length,
    missingResponseUsage: accounting.trials.reduce((n, r) => n + r.wireUsageCountGap, 0),
    fullRequestCacheAccounting: tr.rows.filter(r => r.usage.complete).length },
  tailResultsSha256: createHash("sha256").update(await readFile(join(tail, "results.json"))).digest("hex"),
};
await writeFile(join(tail, "continuation-summary.json"), JSON.stringify(summary, null, 2) + "\n");
for (const name of ["shared-budget-accounting.json", "trial-budget-accounting.json"])
  await writeFile(join(tail, name), await readFile(join(repo, ".blame/research/navigation-evidence-rename-tail/f25", name)));
console.log(JSON.stringify(summary));
