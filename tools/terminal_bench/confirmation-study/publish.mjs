// Publish completed campaigns only. Raw bytes, grades and source reviews stay separate.
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { repo, study as defaultStudy, work as defaultWork, sha, json, save } from './setup.mjs';
const work = process.argv[2] ? resolve(process.argv[2]) : defaultWork;
const study = process.argv[3] ? resolve(process.argv[3]) : defaultStudy;
const campaign = join(work, 'campaign');
const protocol = await json(join(study, 'protocol.json'));
const analysis = await json(join(campaign, 'analysis.json'));
const exit = await json(join(campaign, 'driver-exit.json'));
assert.equal(exit.complete, true); assert.equal(analysis.rows.length, protocol.order.length);
const review = await json(join(study, 'source-review.json'));
assert.equal(review.decisions.length, analysis.rows.length);
const rows = [];
await mkdir(join(study, 'traces'), { recursive: true });
for (const row of analysis.rows) {
  const directory = join(campaign, row.name), files = {};
  const decision = review.decisions.find(decision => decision.name === row.name);
  assert.ok(decision); assert.deepEqual(decision.hashes, row.hashes);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || ['workspace.tar.gz', 'generated-caches.tar.gz'].includes(entry.name)) continue;
    const bytes = await readFile(join(directory, entry.name));
    for (const [key, value] of Object.entries(process.env)) if (/(?:TOKEN|SECRET|PASSWORD|API_KEY)$/.test(key) && value.length >= 16) assert.ok(!bytes.includes(Buffer.from(value)), 'Configured credential found; retain private evidence and do not publish');
    files[entry.name] = { bytes: bytes.length, sha256: sha(bytes), base64: bytes.toString('base64') };
  }
  const archive = gzipSync(JSON.stringify({ name: row.name, files }), { mtime: 0 });
  await writeFile(join(study, 'traces', row.name + '.json.gz'), archive);
  rows.push({ ...row, auditedCompletion: row.independentFunctionalSuccess &&
    decision.sourceBehaviorPassed && decision.finalSourceChecksPassed && decision.noSolutionRetrieval && decision.fullRequestPassed,
    traceSha256: sha(archive) });
}
await save(join(study, 'results.json'), { phase: protocol.phase, planned: protocol.order.length, completed: rows.length, rows });
await cp(join(campaign, 'accounting.json'), join(study, 'accounting.json'));
await cp(join(campaign, 'driver-exit.json'), join(study, 'driver-exit.json'));
const arms = Object.fromEntries(protocol.arms.map(arm => {
  const selected = rows.filter(row => row.arm === arm);
  const sum = field => selected.every(row => row.usage[field] !== null) ? selected.reduce((sum, row) => sum + row.usage[field], 0) : null;
  return [arm, { trials: selected.length, official: selected.filter(row => row.officialRuntimeSuccess).length,
    independent: selected.filter(row => row.independentFunctionalSuccess).length, audited: selected.filter(row => row.auditedCompletion).length,
    input: sum('input'), output: sum('output'), tokens: sum('input') === null || sum('output') === null ? null : sum('input') + sum('output'),
    receiptedInputOutputCostComplete: selected.every(row => row.contract.unreported === 0 && row.usage.tokensCostReconciled),
    forwardedRequests: selected.reduce((sum, row) => sum + row.contract.forwarded, 0),
    missingUsageReceipts: selected.reduce((sum, row) => sum + row.contract.unreported, 0),
    cachePerRequestReconciled: selected.every(row => row.usage.reconciliation.cacheRead.matches && row.usage.reconciliation.cacheWrite.matches),
    sdkEstimatedUsd: sum('cost'), cacheRead: sum('cacheRead'), cacheWrite: sum('cacheWrite'), durationMs: selected.reduce((sum, row) => sum + row.durationMs, 0),
    declarationCalls: selected.reduce((sum, row) => sum + row.declarationCalls, 0),
    sourceVerificationAdmitted: arm === 'cline' ? null : selected.filter(row => row.completion?.verification === 'verified').length,
    compilerObligationSatisfied: arm === 'cline' ? null : selected.filter(row => row.completion?.satisfied_obligations?.includes('check:types')).length }];
}));
const treatment = protocol.arms.find(arm => !['reference', 'cline'].includes(arm));
const delta = (a, b) => b === 0 || a === null || b === null ? null : a / b - 1;
function compare(predicate) {
const comparisons = {};
for (const reference of ['reference', 'cline']) {
  const paired = rows.filter(row => row.arm === treatment && predicate(row) &&
    rows.some(other => other.arm === reference && other.repeat === row.repeat && other.task === row.task && predicate(other)));
  const totals = arm => {
    const selected = paired.map(row => rows.find(other => other.arm === arm && other.repeat === row.repeat && other.task === row.task));
    const known = selected.every(row => row.contract.unreported === 0 && row.usage.tokensCostReconciled);
    return { trials: selected.length, tokens: known ? selected.reduce((sum, row) => sum + row.usage.input + row.usage.output, 0) : null,
      cost: known ? selected.reduce((sum, row) => sum + row.usage.cost, 0) : null, durationMs: selected.reduce((sum, row) => sum + row.durationMs, 0) };
  };
  const candidate = totals(treatment), baseline = totals(reference);
  const pairDetails = paired.map(row => {
    const other = rows.find(other => other.arm === reference && other.repeat === row.repeat && other.task === row.task);
    const known = [row, other].every(row => row.contract.unreported === 0 && row.usage.tokensCostReconciled);
    return { repeat: row.repeat, task: row.task, candidate: row.name, baseline: other.name,
      tokenDelta: known ? delta(row.usage.input + row.usage.output, other.usage.input + other.usage.output) : null,
      costDelta: known ? delta(row.usage.cost, other.usage.cost) : null, durationDelta: delta(row.durationMs, other.durationMs) };
  });
  const leaveOnePairOut = paired.length > 2 ? paired.map(omitted => {
    const retained = paired.filter(row => row !== omitted);
    const tokens = arm => {
      const selected = retained.map(row => rows.find(other => other.arm === arm && other.repeat === row.repeat && other.task === row.task));
      return selected.every(row => row.contract.unreported === 0 && row.usage.tokensCostReconciled)
        ? selected.reduce((sum, row) => sum + row.usage.input + row.usage.output, 0) : null;
    };
    return { omitted: omitted.name, tokenDelta: delta(tokens(treatment), tokens(reference)) };
  }) : [];
  comparisons[`${treatment}/${reference}`] = { pairs: paired.length, candidate, baseline, pairDetails, leaveOnePairOut,
    tokenDelta: delta(candidate.tokens, baseline.tokens), costDelta: delta(candidate.cost, baseline.cost), durationDelta: delta(candidate.durationMs, baseline.durationMs) };
}
for (const reference of ['reference', 'cline']) {
 const comparison = comparisons[`${treatment}/${reference}`];
 comparison.byTask = protocol.tasks.map(task => {
  const pairs = comparison.pairDetails.filter(p => p.task === task.id);
  const total = arm => pairs.reduce((n,p) => {const r=rows.find(r=>r.arm===arm&&r.task===task.id&&r.repeat===p.repeat);return n+r.usage.input+r.usage.output;},0);
  return {task:task.id,project:task.project,pairedSuccesses:pairs.length,tokenDelta:pairs.every(p=>p.tokenDelta!==null)?delta(total(treatment),total(reference)):null,
   quality:Object.fromEntries(protocol.arms.map(arm=>[arm,rows.filter(r=>r.arm===arm&&r.task===task.id&&r.auditedCompletion).length]))};
 });
 comparison.leaveOneTaskOut = protocol.tasks.map(task => {
  const pairs=comparison.pairDetails.filter(p=>p.task!==task.id);
  const total=arm=>pairs.reduce((n,p)=>{const r=rows.find(r=>r.arm===arm&&r.task===p.task&&r.repeat===p.repeat);return n+r.usage.input+r.usage.output;},0);
  return {omitted:task.id,pairs:pairs.length,tokenDelta:pairs.every(p=>p.tokenDelta!==null)?delta(total(treatment),total(reference)):null};
 });
 comparison.pairedTokenWins=comparison.pairDetails.filter(p=>p.tokenDelta!==null&&p.tokenDelta<0).length;
 comparison.pairedTokenLosses=comparison.pairDetails.filter(p=>p.tokenDelta!==null&&p.tokenDelta>0).length;
}
return comparisons;
}
const comparisons = compare(row => row.auditedCompletion);
const functionalComparisons = compare(row => row.independentFunctionalSuccess);
const qualityGate = arms[treatment].audited >= arms.reference.audited;
const comparison = comparisons[`${treatment}/reference`];
const resourceGate = qualityGate && comparison.pairs >= 12 &&
  comparison.tokenDelta !== null && comparison.tokenDelta < 0 && comparison.costDelta < 0 && comparison.durationDelta <= 0.1;
const accounting = await json(join(study, 'accounting.json')), prior = await json(join(study, 'prior-budget.json'));
await save(join(study, 'summary.json'), { phase: protocol.phase, complete: true, arms, comparisons, functionalComparisons,
  functionalComparisonCaveat: 'Secondary descriptive comparison on selected-check success only. It can include incorrect extra changes or instruction violations; it cannot establish full-task quality parity.', qualityGate, resourceGate,
  accounting, priorObservedUsd: prior.observedUsd, priorReservedUsd: prior.reservedUsd,
  cumulativeObservedSdkUsd: prior.observedUsd + accounting.observedUsd, cumulativeReservedUsd: prior.reservedUsd + accounting.reservedUsd,
  cumulativeAccountedUsd: prior.accountedUsd + accounting.accountedUsd,
  limitations: 'Six constructed fresh tasks in two previously unmeasured projects; dependent repeats, unblinded source review by the research agent, unknown provider revision/seeds/invoices, nonexclusive host. SDK estimates/cache receipts are observations, not complete provider billing. Do not pool campaigns or attribute resource differences to unused mechanisms. Whole private workspace archives are retained by SHA-256; public traces include original diffs, events, grades, contracts and deliveries. The full runtime suite overlapped the first model block on this nonexclusive host; duration is observational and sensitivity must be reported.' });
console.log(JSON.stringify({ phase: protocol.phase, arms, qualityGate, resourceGate }));
