// Financial sum only; never pool different feature versions into an efficacy claim.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import assert from "node:assert/strict";
import { repo, studyFor } from "./campaign-paths.mjs";

assert.equal(process.env.BLAME_STUDY_VARIANT, "budget050");
const json = async path => JSON.parse(await readFile(path, "utf8"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const root = join(repo, "docs/experiments/light-harness-navigation-evidence-budget050-2026-10-13");
const protocol = await json(join(root, "protocol.json"));
const panels = [], requests = [], rows = [];
for (const panel of ["f18", "f19", "f20"]) {
  const study = studyFor(panel), bytes = await readFile(join(study, "results.json"));
  const results = JSON.parse(bytes), registered = await json(join(study, "protocol.json"));
  const original = await json(join(repo,
    `docs/experiments/light-harness-navigation-evidence-${panel}-2026-10-13/protocol.json`));
  assert.deepEqual(registered.tasks, original.tasks, "No changed prompts, seeds, suites or task selection");
  assert.equal(registered.budgets.sharedStudyObservedCostStopUsd, .5);
  assert.equal(registered.budgets.requestMaxOutputTokens, 8192);
  panels.push({ panel, resultsSha256: sha(bytes), planned: results.planned,
    completed: results.completed, officialSuccesses: results.rows.filter(r => r.officialRuntimeSuccess).length,
    auditedSuccesses: results.rows.filter(r => r.auditedCompletion).length,
    estimatedUsd: results.rows.reduce((n, r) => n + (r.usage.cost ?? 0), 0),
    missingCostAggregates: results.rows.filter(r => r.usage.cost === null).length });
  for (const row of results.rows) {
    rows.push(row);
    requests.push(...row.usage.perRequest.map((usage, index) => ({ panel, name: row.name, index: index + 1, ...usage })));
  }
}
const previous = await Promise.all(["f18", "f19", "f20"].map(panel => json(join(repo,
  `docs/experiments/light-harness-navigation-evidence-${panel}-2026-10-13/results.json`))));
const observedUsd = panels.reduce((n, panel) => n + panel.estimatedUsd, 0);
const oldUsd = previous.flatMap(p => p.rows).reduce((n, r) => n + (r.usage.cost ?? 0), 0);
const observedOutputs = requests.filter(r => r.output !== null).map(r => r.output);
const outputPeak = observedOutputs.length ? Math.max(...observedOutputs) : null;
const summary = {
  method: "Known-task diagnostics. Panel-specific versions and performance comparisons remain separate. Only financial spending and audit completeness are summed. SDK estimates are not invoices. No gold recovery, model workspace repair, paid retry or new selected task.",
  panels, planned: panels.reduce((n, p) => n + p.planned, 0), completed: rows.length,
  officialSuccesses: rows.filter(r => r.officialRuntimeSuccess).length,
  auditedSuccesses: rows.filter(r => r.auditedCompletion).length,
  unexecuted: panels.reduce((n, p) => n + p.planned - p.completed, 0),
  timeouts: rows.filter(r => r.status === "timed_out").length,
  watchdogs: rows.filter(r => r.exit.watchdog).length,
  tokenCostReconciled: rows.filter(r => r.usage.tokensCostReconciled).length,
  fullRequestCacheAccounting: rows.filter(r => r.usage.complete).length,
  requestUsageReports: requests.length, maximumObservedRequestOutputTokens: outputPeak,
  requestCapReached: requests.filter(r => r.output === protocol.commonRequestMaxOutputTokens).length,
  requestCapExceeded: requests.filter(r => r.output !== null && r.output > protocol.commonRequestMaxOutputTokens).length,
  missingRequestOutputTokens: requests.filter(r => r.output === null).length,
  observedEstimatedUsd: observedUsd, newPhaseStopUsd: protocol.userAuthorizedNewPhaseEstimatedUsd,
  withinObservedBudget: observedUsd <= protocol.userAuthorizedNewPhaseEstimatedUsd,
  previousSeparatePhaseEstimatedUsd: oldUsd, combinedFinancialEstimateOnlyUsd: observedUsd + oldUsd,
  limitation: "Serialization and observed request output are separate from provider enforcement. Neither budget nor cap exceptions are filtered out. Caption and exclusive-report-directory releases are not included in these original feature arms. Larger session allowance, cap and stochastic trajectory differ from the old campaign; no causal removal of the old burst follows.",
};
await writeFile(join(root, "phase-summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary));
