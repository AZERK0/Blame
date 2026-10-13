// Read-only model outcome/trace analysis after independent source-review decisions.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { repo, work, studyFor } from "./campaign-paths.mjs";
import { reserveTrialCosts } from "./budget-accounting.mjs";
assert.equal(process.env.BLAME_STUDY_VARIANT, "rename-ablation");
const study = studyFor("f25"), campaign = join(work, "f25");
const json = async path => JSON.parse(await readFile(path, "utf8"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const protocol = await json(join(study, "protocol.json")), results = await json(join(study, "results.json"));
const ledger = await json(join(campaign, "tool-ledger.json")), wireByTrial = {}, mechanisms = [];
for (const row of results.rows) {
  const tools = ledger.find(t => t.name === row.name).tools;
  const wire = (await readFile(join(campaign, row.name, "wire-contracts.jsonl"), "utf8"))
    .trim().split("\n").filter(Boolean).map(JSON.parse);
  wireByTrial[row.name] = wire;
  const searches = tools.filter(t => t.tool === "search_code");
  const syntaxSearches = searches.filter(t => ["symbol", "auto"].includes(t.input.mode) || !t.input.mode);
  const commands = tools.flatMap((t, index) => t.tool === "run_task" ? [{ index, tool: t.tool,
    input: t.input, command: t.output?.data?.command ?? t.input.command ?? null,
    status: t.output?.status ?? null, exitCode: t.output?.data?.exitCode ?? null,
    admittedCheck: t.output?.data?.check ?? null }]
    : t.tool === "run_commands" ? (Array.isArray(t.input.commands) ? t.input.commands : typeof t.input.commands === "string" ? [t.input.commands] : []).map((command, item) => ({ index, tool: t.tool,
      command, success: Array.isArray(t.output) ? t.output[item]?.success ?? null : null })) : []);
  const events = (await readFile(join(campaign, row.name, "events.jsonl"), "utf8"))
    .trim().split("\n").filter(Boolean).map(line => JSON.parse(line).event);
  const finalReport = [...tools].reverse().find(t => t.tool === "finish_task")?.input.summary ??
    [...events].reverse().find(e => e.type === "done")?.payload?.text ?? null;
  const lastEditIndex = tools.reduce((last, t, index) => ["edit_code", "apply_patch"].includes(t.tool) ? index : last, -1);
  const fullSuiteCalls = commands.filter(c => c.index > lastEditIndex &&
    c.command?.includes("npm test -- --maxWorkers=1 --minWorkers=1 --pool=forks"));
  mechanisms.push({ name: row.name, eventsSha256: row.eventsSha256, searchInputs: searches.map(t => t.input),
    syntaxSearches: syntaxSearches.length, syntaxSearchInputs: syntaxSearches.map(t => t.input),
    referenceFallbacks: searches.filter(t => t.output?.data?.semanticFallback).map(t => ({ input: t.input, fallback: t.output.data.semanticFallback })),
    compilerReferenceCalls: row.semanticReferenceCalls, compilerRenameCalls: row.semanticRenameCalls,
    disabledRenameCalls: tools.filter(t => t.tool === "edit_code" && t.output?.status === "blocked" && t.output?.message?.includes("Compiler rename is disabled")).length,
    editCalls: tools.filter(t => ["edit_code", "apply_patch"].includes(t.tool)).map(t => ({ input: t.input, status: t.output?.status ?? null, message: t.output?.message ?? null })),
    readCalls: tools.filter(t => ["read_code", "read_files"].includes(t.tool)).length,
    signatureRequests: tools.filter(t => t.tool === "read_code" && t.input.view === "signature").length,
    searchBytes: tools.filter(t => ["search_code", "search_codebase"].includes(t.tool)).reduce((n, t) => n + Buffer.byteLength(JSON.stringify(t.output) ?? ""), 0),
    readBytes: tools.filter(t => ["read_code", "read_files"].includes(t.tool)).reduce((n, t) => n + Buffer.byteLength(JSON.stringify(t.output) ?? ""), 0),
    commands, lastEditIndex, fullSuiteCalls: fullSuiteCalls.length, finalReport,
    actualWireAttempts: wire.filter(r => !r.budgetRejected).length, reportedRequestUsage: row.usage.perRequest.length,
    missingWireResponseUsage: Math.max(0, wire.filter(r => !r.budgetRejected).length - row.usage.perRequest.length),
    admittedCompletion: row.completion?.verification ?? null,
    modelRequests: row.metrics?.context?.modelRequests ?? null, requestsWithFullUsage: row.usage.perRequest.filter(u => u.completeness === "complete").length });
}
function paired(left, right, tier) {
  const accept = row => row.officialRuntimeSuccess && row.independentFunctionalSuccess && row.agentRequiredChecksPassed &&
    row.noSolutionRetrieval && row.usage.tokensCostReconciled && (tier === "functional" || row.auditedCompletion);
  const pairs = results.rows.filter(r => r.arm === left && accept(r)).map(a => [a, results.rows.find(b =>
    b.arm === right && b.id === a.id && b.repetition === a.repetition && accept(b))]).filter(p => p[1]);
  const get = { tokens: r => r.usage.input + r.usage.output, input: r => r.usage.input, output: r => r.usage.output,
    estimatedUsd: r => r.usage.cost, runnerSeconds: r => r.durationMs / 1000, outerAgentSeconds: r => r.outerAgentMs / 1000 };
  const groups = ids => Object.fromEntries(Object.entries(get).map(([metric, value]) => {
    const selected = pairs.filter(([a]) => !ids || ids.includes(a.id));
    const a = selected.reduce((n, p) => n + value(p[0]), 0), b = selected.reduce((n, p) => n + value(p[1]), 0);
    return [metric, { left: a, right: b, leftMean: selected.length ? a / selected.length : null,
      rightMean: selected.length ? b / selected.length : null, relativeChange: b ? a / b - 1 : null }];
  }));
  return { left, right, tier, pairs: pairs.length,
    method: tier === "functional" ? "Secondary matched source/commands quality, excluding final-report wording from this tier; retain strict audit separately."
      : "Primary strict full-audit matched quality, including final reporting; reconciled token/cost usage required.",
    resources: groups(), tasks: protocol.tasks.map(t => ({ id: t.id, pairs: pairs.filter(([a]) => a.id === t.id).length, resources: groups([t.id]) })),
    individual: pairs.map(([a, b]) => ({ id: a.id, repetition: a.repetition,
      ...Object.fromEntries(Object.entries(get).map(([name, value]) => [name, value(b) ? value(a) / value(b) - 1 : null])) })) };
}
const accounting = reserveTrialCosts(results.rows, wireByTrial, protocol.budgets);
const prior = await json(join(campaign, "shared-budget-accounting.json"));
const totalAccountedUsd = prior.priorObservedCost + accounting.accountedUsd;
assert(totalAccountedUsd <= protocol.budgets.sharedStudyObservedCostStopUsd);
const summary = { method: "Registered compiler-rename availability ablation, two known task clusters and two repetitions. All assigned outcomes retained; official, functional, agent-executed checks, strict reporting criteria and admitted verification remain distinct. No source repair, paid trial retry or solution recovery. Compare identical versions only; earlier campaigns contribute financial accounting, never efficacy observations.",
  protocolSha256: sha(await readFile(join(study, "protocol.json"))), planned: results.planned, completed: results.completed,
  unexecuted: results.planned - results.completed, arms: Object.fromEntries(protocol.arms.map(arm => {
    const rows = results.rows.filter(r => r.arm === arm);
    return [arm, { planned: results.provenance.order.filter(t => t.arm === arm).length, attempted: rows.length,
      official: rows.filter(r => r.officialRuntimeSuccess).length, functional: rows.filter(r => r.independentFunctionalSuccess).length,
      actualRequestedCommands: rows.filter(r => r.agentRequiredChecksPassed).length, strictAudited: rows.filter(r => r.auditedCompletion).length,
      fullRequestCacheAccounting: rows.filter(r => r.usage.complete).length,
      tokenCostReconciled: rows.filter(r => r.usage.tokensCostReconciled).length,
      tokensObserved: rows.reduce((n, r) => n + (r.usage.input ?? 0) + (r.usage.output ?? 0), 0),
      estimatedUsdObserved: rows.reduce((n, r) => n + (r.usage.cost ?? 0), 0),
      runnerSecondsObserved: rows.reduce((n, r) => n + (r.durationMs ?? 0), 0) / 1000 }];
  })), comparisons: ["strict", "functional"].flatMap(tier => [["modified", "baseline"], ["modified", "cline"], ["baseline", "cline"]].map(([a, b]) => paired(a, b, tier))),
  newCampaignAccounting: accounting, priorObservedOrReservedUsd: prior.priorObservedCost, totalAccountedUsd,
  referenceEquivalentEur: totalAccountedUsd / protocol.budgetAmendment.referenceFx.usdPerEur,
  operationalCeilingUsd: protocol.budgets.sharedStudyObservedCostStopUsd, authorizedCeilingEur: 1,
  invoiceVerified: false, missingWireResponseUsage: mechanisms.reduce((n, r) => n + r.missingWireResponseUsage, 0),
  syntaxSearchesInLight: mechanisms.filter(r => !r.name.endsWith("-cline")).reduce((n, r) => n + r.syntaxSearches, 0),
  timeouts: results.rows.filter(r => r.status === "timed_out").length, watchdogs: results.rows.filter(r => r.exit.watchdog).length,
  limitations: "Previously observed internal migrations on one reused project; only two diagnostic clusters/two repetitions. Baseline blocks compiler editing under the same advertised schema/prompt: removal includes recovery friction. Modified retains current production. Provider revision, seeds, hidden retry behavior, invoices and complete cache accounting are unavailable. Missing cached subsets are not zero-filled. Strict report wording and functional equivalence are separate tiers; no infrastructure-only or wording-only difference establishes improved migration success. Compiler-reference identity, non-rename edits, output retention, schemas and prompts are unchanged. Compare the assigned availability ablation including blocked recovery, not an optimized patch-only prompt. Do not pool old ranking results or SDK costs into causal rename effects." };
// Preserve the concrete remaining admission gap without relaxing the runtime.
const validationGap = [], endpoints = [];
const journalInventory = await json(join(study, "supplemental-inventory.json"));
const { gunzipSync } = await import("node:zlib");
const expected = new Map();
for (const row of results.rows) {
  const task = protocol.tasks.find(t => t.id === row.id);
  const score = await json(join(campaign, row.name, "score.json"));
  if (!expected.has(row.id)) {
    const { applyOracle } = await import("./multifile-criteria.mjs");
    expected.set(row.id, Object.fromEntries(await Promise.all(task.allowedPaths.map(async path => {
      const text = task.inputFiles?.[path] ?? await readFile(join(repo, protocol.upstreams[task.project].sourceRoot, path), "utf8");
      return [path, sha(Buffer.from(applyOracle(text, task.oracle.spans[path] ?? [], task.newName)))];
    }))));
  }
  endpoints.push({ name: row.name, scoreSha256: row.scoreSha256,
    sources: score.sourceSha256, byteMatchesOracle: Object.entries(expected.get(row.id)).every(([path, hash]) => score.sourceSha256[path] === hash) });
  if (row.arm === "cline") continue;
  const observations = [];
  for (const artifact of journalInventory.journals.filter(j => j.name === row.name)) {
    const bytes = gunzipSync(await readFile(join(study, artifact.artifact))); assert.equal(sha(bytes), artifact.sha256);
    for (const event of bytes.toString().split("\n").filter(Boolean).map(JSON.parse))
      if (event.type === "validation" && event.taskKind === "test") observations.push({
        id: event.id, command: event.command, args: event.args, cwd: event.cwd,
        sourceRevisionId: event.sourceRevisionId, check: event.check,
        recordedStatus: event.status, recordedTerminal: event.terminal,
        sameAsCompletionSource: event.sourceRevisionId === row.completion?.source_revision_id,
        recordedFileHashesMatchFinal: (event.files ?? []).length > 0 && event.files.every(f => score.sourceSha256[f.path] === f.hash),
        journalSha256: artifact.sha256 });
  }
  validationGap.push({ name: row.name, eventsSha256: row.eventsSha256,
    completion: row.completion, actualTestObservations: observations });
}
await writeFile(join(study, "final-source-endpoints.json"), JSON.stringify({ method: "All final score hashes compared with the registered private binding oracle; no agent workspace modified and no oracle feedback.", rows: endpoints }, null, 2) + "\n");
await writeFile(join(study, "validation-gap.json"), JSON.stringify({ method: "Exact journal test observations bound to final scored files and completion revision, independently of runtime admission. An equal recorded source hash does not authenticate console output or admit runner selection; unverified stays unverified.", rows: validationGap }, null, 2) + "\n");
await writeFile(join(study, "rename-ablation-summary.json"), JSON.stringify(summary, null, 2) + "\n");
await writeFile(join(study, "rename-ablation-mechanisms.json"), JSON.stringify({ rows: mechanisms }, null, 2) + "\n");
console.log(JSON.stringify({ planned: summary.planned, completed: summary.completed, arms: summary.arms,
  totalAccountedUsd, syntaxSearchesInLight: summary.syntaxSearchesInLight }));
