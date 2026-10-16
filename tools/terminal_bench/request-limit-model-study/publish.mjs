// Publish complete and failed assigned trials without repairing sources or runs.
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { repo, work, study } from './paths.mjs';
import { reserveTrialCosts } from '../navigation-evidence/budget-accounting.mjs';
import { evaluateCapContract } from './cap-contract.mjs';
const json = async path => JSON.parse(await readFile(path));
const sha = b => createHash('sha256').update(b).digest('hex');
const p = await json(join(study, 'protocol.json'));
const campaign = join(work, 'f36');
const analysis = await json(join(campaign, 'analysis.json'));
const review = await readFile(join(study, 'source-review.json')).then(JSON.parse, e => { if (e.code === 'ENOENT') return { decisions: [] }; throw e; });
const wire = {}, inventory = [], exposures = [], rows = [];
await mkdir(join(study, 'traces'), { recursive: true });
for (const original of analysis.rows) {
  const directory = join(campaign, original.name);
  const files = {};
  const contracts = (await readdir(directory)).filter(name => /^(?:prompt|schema)-[a-f0-9]{64}\.json$/u.test(name));
  for (const name of ['events.jsonl', 'workspace.diff', 'score.json', 'result.json', 'instruction.txt', 'required-checks.json', 'wire-contracts.jsonl', 'model-exit.json', 'model-start.json', 'prompt-date-loads.jsonl', 'native-search-loads.jsonl', 'orchestration-interruption.json', 'cap-contract.json', ...contracts]) {
    const bytes = await readFile(join(directory, name)).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (!bytes) continue;
    // Refuse accidental publication of configured credential bytes; retain the
    // untouched private artifact. Never print credentials in an exception.
    for (const [key, value] of Object.entries(process.env))
      if (/(?:TOKEN|SECRET|PASSWORD|API_KEY)$/u.test(key) && value?.length >= 12 && bytes.includes(Buffer.from(value)))
        throw Error('Configured secret found; publication refused for ' + original.name + '/' + name);
    files[name] = { sha256: sha(bytes), bytes: bytes.length, base64: bytes.toString('base64') };
  }
  assert.equal(files['events.jsonl'].sha256, original.eventsSha256);
  assert.equal(files['workspace.diff'].sha256, original.diffSha256);
  assert.equal(files['score.json'].sha256, original.scoreSha256);
  const archived = gzipSync(JSON.stringify({ name: original.name, files }), { mtime: 0 });
  const artifact = 'traces/' + original.name + '.json.gz';
  await writeFile(join(study, artifact), archived);
  inventory.push({ name: original.name, artifact, sha256: sha(archived), files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, { sha256: v.sha256, bytes: v.bytes }])) });
  wire[original.name] = Buffer.from(files['wire-contracts.jsonl'].base64, 'base64').toString().trim().split('\n').filter(Boolean).map(JSON.parse);
  const tools = Buffer.from(files['events.jsonl'].base64, 'base64').toString().trim().split('\n').map(JSON.parse)
    .filter(e => e.event?.type === 'tool').map(e => ({ ...e.event.payload,
      tool: e.event.payload.toolCall?.name ?? e.event.payload.tool,
      input: e.event.payload.toolCall?.input ?? e.event.payload.input })).filter(t => t.phase === 'finished');
  const projects = tools.filter(t => t.tool === 'run_task' && t.input?.kind === 'project');
  exposures.push({ name: original.name, projectCalls: projects.map(t => ({ input: t.input, status: t.output?.status, returnedCommand: t.output?.data?.command ?? null })),
    finishCalls: tools.filter(t => t.tool === 'finish_task').map(t => ({ input: t.input, output: t.output })) });
  const d = review.decisions.find(d => d.name === original.name);
  if (d) for (const key of ['eventsSha256', 'diffSha256', 'scoreSha256']) assert.equal(d[key], original[key], 'Review binding changed');
  rows.push({ ...original, review: d ?? null, fullAuditedSuccess: d ? original.officialRuntimeSuccess && original.independentFunctionalSuccess && d.sourceBehaviorPassed && d.exactFinalSourceChecksPassed && d.fullRequestPassed && d.noSolutionRetrieval : null });
}
const schedulerAccounting = reserveTrialCosts(rows, wire, p.budgets);
// Missing runtime aggregates do not erase usage events already received. Keep
// these as partial observations, never fabricate an official result/aggregate.
const partialUsageObservations = rows.filter(r => r.usage.cost === null).map(r => ({
  name: r.name, reports: r.usage.perRequest.length,
  input: r.usage.perRequest.reduce((n, u) => n + (u.input ?? 0), 0),
  output: r.usage.perRequest.reduce((n, u) => n + (u.output ?? 0), 0),
  costUsd: r.usage.perRequest.reduce((n, u) => n + (u.cost ?? 0), 0),
  missingReportFields: r.usage.perRequest.filter(u => u.input === null || u.output === null || u.cost === null).length,
  basis: 'Received per-request usage events only; missing official aggregate remains missing.'
}));
const partialUsd = partialUsageObservations.reduce((n, r) => n + r.costUsd, 0);
const accounting = { ...schedulerAccounting, aggregateOnlyObservedUsd: schedulerAccounting.observedUsd,
  observedUsd: schedulerAccounting.observedUsd + partialUsd,
  accountedUsd: schedulerAccounting.accountedUsd + partialUsd, partialUsageObservations,
  partialObservedUsd: partialUsd,
  reservationNote: 'Retain the entire scheduler missing-aggregate allowance in addition to known partial observations. Conservative overlap is explicit; reserves are not spending.' };
const prior = await json(join(study, 'prior-budget.json'));
const arms = Object.fromEntries(p.arms.map(arm => {
  const subset = rows.filter(r => r.arm === arm);
  return [arm, { assigned: p.order.filter(r => r.arm === arm).length, completed: subset.length,
    official: subset.filter(r => r.officialRuntimeSuccess).length, endpoint: subset.filter(r => r.independentFunctionalSuccess).length,
    audited: subset.filter(r => r.fullAuditedSuccess).length, unreviewed: subset.filter(r => r.fullAuditedSuccess === null).length,
    tokensObserved: subset.reduce((n, r) => n + (r.usage.input ?? 0) + (r.usage.output ?? 0), 0),
    costUsdObserved: subset.reduce((n, r) => n + (r.usage.cost ?? 0), 0),
    partialTokensObserved: partialUsageObservations.filter(r => r.name.endsWith('-' + arm)).reduce((n, r) => n + r.input + r.output, 0),
    partialCostUsdObserved: partialUsageObservations.filter(r => r.name.endsWith('-' + arm)).reduce((n, r) => n + r.costUsd, 0),
    workerSeconds: subset.reduce((n, r) => n + (r.durationMs ?? 0), 0) / 1000,
    missingConsumption: subset.filter(r => r.usage.input === null || r.usage.output === null || r.usage.cost === null).length,
    missingWorkerTime: subset.filter(r => r.durationMs === null).length,
    missingFullCacheAccounting: subset.filter(r => !r.usage.complete).length,
    cacheReadAggregateObserved: subset.reduce((n, r) => n + (r.usage.cacheRead ?? 0), 0),
    cacheWriteAggregateObserved: subset.reduce((n, r) => n + (r.usage.cacheWrite ?? 0), 0),
    missingCacheReadAggregates: subset.filter(r => r.usage.cacheRead === null).length,
    missingCacheWriteAggregates: subset.filter(r => r.usage.cacheWrite === null).length,
    projectCalls: exposures.filter(e => e.name.endsWith('-' + arm)).reduce((n, e) => n + e.projectCalls.length, 0) }];
}));
const comparisons = [];
for (const [left, right] of [['candidate', 'baseline'], ['cline-cap', 'cline'], ['candidate', 'cline-cap']]) {
  const pairs = rows.filter(a => a.arm === left && a.fullAuditedSuccess && a.usage.tokensCostReconciled).flatMap(a => {
    const b = rows.find(b => b.arm === right && a.id === b.id && a.repetition === b.repetition && b.fullAuditedSuccess && b.usage.tokensCostReconciled);
    return b ? [[a, b]] : [];
  });
  const resources = {};
  for (const [key, value] of Object.entries({ tokens: r => r.usage.input + r.usage.output, cost: r => r.usage.cost, seconds: r => r.durationMs / 1000 })) {
    const a = pairs.reduce((n, [a]) => n + value(a), 0), b = pairs.reduce((n, [, b]) => n + value(b), 0);
    resources[key] = { left: a, right: b, relativeChange: b ? a / b - 1 : null };
  }
  comparisons.push({ left, right, pairs: pairs.length, names: pairs.map(([a, b]) => [a.name, b.name]), resources });
}
const complete = rows.length === p.order.length && rows.every(r => r.review);
const withinQuality = (left,right) => complete ? arms[left].audited >= arms[right].audited && rows.filter(r=>r.arm===left&&r.review.sourceBehaviorPassed).length >= rows.filter(r=>r.arm===right&&r.review.sourceBehaviorPassed).length : null;
const withinResource = comparison => { if(!complete)return null; const r=comparison.resources;return comparison.pairs>0&&(r.tokens.relativeChange<=-.1||r.cost.relativeChange<=-.1)&&r.cost.relativeChange<=.05&&r.seconds.relativeChange<=.1; };
const qualityGates={light:withinQuality('candidate','baseline'),native:withinQuality('cline-cap','cline')};
const resourceGates={light:withinResource(comparisons[0]),native:withinResource(comparisons[1])};
const qualityGate=complete?Object.values(qualityGates).every(Boolean):null;
const resourceGate=complete?Object.values(resourceGates).every(Boolean):null;
const requestCapContracts = rows.map(r => ({ name: r.name,
  ...evaluateCapContract(r.arm, wire[r.name], r.usage.perRequest, p.budgets.requestMaxOutputTokens),
  outputReports: r.usage.perRequest.length,
  maximumObservedOutput: r.usage.perRequest.some(u => typeof u.output === 'number') ? Math.max(...r.usage.perRequest.filter(u => typeof u.output === 'number').map(u => u.output)) : null,
  outputsAtCap: r.usage.perRequest.filter(u => u.output === p.budgets.requestMaxOutputTokens).length }));
const summary = { phase: 'F36', knownDiagnostic: true, planned: p.order.length, completed: rows.length, complete,
  arms, comparisons, qualityGate, resourceGate, qualityGates, resourceGates, requestCapContracts, accounting, priorObservedUsd: prior.observedUsd,
  priorReservedUsd: prior.reservedUsd, totalAccountedUsd: prior.accountedUsd + accounting.accountedUsd,
  method: 'Separate known-task diagnostic. Original bytes archived; strict review never replaced by independent grading. Unknown per-request cache/reasoning retained; costs are SDK estimates, host/researcher/setup/oracle unpriced. No outcome-based extra trials.' };
for (const [name, value] of Object.entries({ 'results.json': { ...analysis, rows }, 'inventory.json': inventory, 'exposure.json': exposures, 'summary.json': summary }))
  await writeFile(join(study, name), JSON.stringify(value, null, 2) + '\n');
console.log(JSON.stringify({ completed: rows.length, reviewed: review.decisions.length, arms, qualityGate, resourceGate, phaseAccountedUsd: accounting.accountedUsd, totalAccountedUsd: summary.totalAccountedUsd }));
