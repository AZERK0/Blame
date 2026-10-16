// Public byte/usage/arithmetic replay. Does not substitute for source review or
// execute the behavioral oracle, and never issues model requests.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { study as defaultStudy } from './paths.mjs';
import { reconcileUsage } from '../corpus/light-study-accounting.mjs';
import { reserveTrialCosts } from '../navigation-evidence/budget-accounting.mjs';
const study = resolve(process.argv[2] ?? defaultStudy);
const json = async name => JSON.parse(await readFile(join(study, name)));
const sha = b => createHash('sha256').update(b).digest('hex');
const p = await json('protocol.json'), launch = await json('launch-registration.json');
assert.equal(launch.protocolSha256, sha(await readFile(join(study, 'protocol.json'))));
assert.equal(p.order.length, 9); assert.equal(p.repetitions, 3);
assert.deepEqual(p.arms, ['baseline', 'candidate', 'cline']);
assert.equal(p.studyKind, 'actual-invocation-display-known-diagnostic');
const results = await json('results.json'), summary = await json('summary.json');
const review = await json('source-review.json'), inventory = await json('inventory.json');
const wire = {}, exposures = [];
assert.equal(inventory.length, results.rows.length);
for (const row of results.rows) {
  assert.ok(p.order.some(t => [t.repetition, t.id, t.arm].join('-') === row.name));
  const item = inventory.find(i => i.name === row.name);
  assert.ok(item && /^traces\/[\w-]+\.json\.gz$/u.test(item.artifact));
  const bytes = await readFile(join(study, item.artifact)); assert.equal(sha(bytes), item.sha256);
  const archive = JSON.parse(gunzipSync(bytes)); assert.equal(archive.name, row.name);
  const files = {};
  for (const [name, file] of Object.entries(archive.files)) {
    const b = Buffer.from(file.base64, 'base64');
    assert.equal(sha(b), file.sha256); assert.equal(b.length, file.bytes);
    assert.deepEqual(item.files[name], { bytes: b.length, sha256: sha(b) }); files[name] = b;
  }
  for (const [field, name] of [['eventsSha256', 'events.jsonl'], ['diffSha256', 'workspace.diff'], ['scoreSha256', 'score.json']]) assert.equal(row[field], sha(files[name]));
  const events = files['events.jsonl'].toString().trim().split('\n').map(JSON.parse).map(e => e.event);
  const result = files['result.json'] ? JSON.parse(files['result.json']) : {};
  assert.equal(row.status, result.status ?? 'missing');
  assert.equal(row.officialRuntimeSuccess, result.status === 'succeeded');
  assert.equal(row.durationMs, result.durationMs ?? null);
  assert.equal(row.independentFunctionalSuccess, JSON.parse(files['score.json']).independentFunctionalSuccess);
  const usage = reconcileUsage(result.usage, events.filter(e => e.type === 'usage').map(e => e.payload?.usage), events.filter(e => e.type === 'notice' && e.payload?.message === 'Agent iteration started.').length);
  assert.deepEqual(row.usage, usage);
  wire[row.name] = files['wire-contracts.jsonl'].toString().trim().split('\n').filter(Boolean).map(JSON.parse);
  for (const request of wire[row.name]) { assert.equal(request.model, p.model); assert.equal(request.reasoning?.effort, p.effort); assert.equal(request.byteLimit, p.budgets.maximumSerializedRequestBytes); }
  const tools = events.filter(e => e.type === 'tool').map(e => ({ ...e.payload, tool: e.payload.toolCall?.name ?? e.payload.tool, input: e.payload.toolCall?.input ?? e.payload.input })).filter(t => t.phase === 'finished');
  exposures.push({ name: row.name, projectCalls: tools.filter(t => t.tool === 'run_task' && t.input?.kind === 'project').map(t => ({ input: t.input, status: t.output?.status, returnedCommand: t.output?.data?.command ?? null })), finishCalls: tools.filter(t => t.tool === 'finish_task').map(t => ({ input: t.input, output: t.output })) });
  const decision = review.decisions.find(d => d.name === row.name);
  assert.deepEqual(row.review, decision ?? null);
  if (decision) {
    for (const key of ['eventsSha256', 'diffSha256', 'scoreSha256']) assert.equal(decision[key], row[key]);
    assert.equal(decision.fullRequestPassed, decision.criteriaFailures.length === 0);
  }
  assert.equal(row.fullAuditedSuccess, decision ? row.officialRuntimeSuccess && row.independentFunctionalSuccess && decision.sourceBehaviorPassed && decision.exactFinalSourceChecksPassed && decision.fullRequestPassed && decision.noSolutionRetrieval : null);
  if (!files['result.json']) {
    assert.ok(row.exit.orchestrationInterrupted && files['orchestration-interruption.json']);
    const receipt = JSON.parse(files['orchestration-interruption.json']);
    assert.equal(receipt.modelRetried, false); assert.equal(receipt.actualExitStatus, null);
    assert.deepEqual(receipt.sourceBeforeAndAfterGrading, JSON.parse(files['score.json']).sourceSha256);
  }
}
assert.deepEqual(await json('exposure.json'), exposures);
for (const arm of p.arms) {
  const a = summary.arms[arm], rows = results.rows.filter(r => r.arm === arm);
  assert.equal(a.assigned, 3); assert.equal(a.completed, rows.length);
  for (const [key, field] of [['official', 'officialRuntimeSuccess'], ['endpoint', 'independentFunctionalSuccess'], ['audited', 'fullAuditedSuccess']]) assert.equal(a[key], rows.filter(r => r[field]).length);
  assert.equal(a.unreviewed, rows.filter(r => r.fullAuditedSuccess === null).length);
  assert.equal(a.tokensObserved, rows.reduce((n, r) => n + (r.usage.input ?? 0) + (r.usage.output ?? 0), 0));
  assert.equal(a.costUsdObserved, rows.reduce((n, r) => n + (r.usage.cost ?? 0), 0));
  assert.equal(a.workerSeconds, rows.reduce((n, r) => n + (r.durationMs ?? 0), 0) / 1000);
  assert.equal(a.missingConsumption, rows.filter(r => r.usage.input === null || r.usage.output === null || r.usage.cost === null).length);
  assert.equal(a.missingWorkerTime, rows.filter(r => r.durationMs === null).length);
  assert.equal(a.projectCalls, exposures.filter(e => e.name.endsWith('-' + arm)).reduce((n, e) => n + e.projectCalls.length, 0));
}
const scheduled = reserveTrialCosts(results.rows, wire, p.budgets);
assert.equal(summary.accounting.aggregateOnlyObservedUsd, scheduled.observedUsd);
assert.equal(summary.accounting.reservedUsd, scheduled.reservedUsd);
assert.deepEqual(summary.accounting.trials, scheduled.trials);
const partials = results.rows.filter(r => r.usage.cost === null);
const partialCost = partials.reduce((n, r) => n + r.usage.perRequest.reduce((n, u) => n + (u.cost ?? 0), 0), 0);
assert.equal(summary.accounting.partialObservedUsd, partialCost);
assert.equal(summary.accounting.observedUsd, scheduled.observedUsd + partialCost);
assert.equal(summary.accounting.accountedUsd, scheduled.accountedUsd + partialCost);
const prior = await json('prior-budget.json');
assert.equal(prior.observedUsd + prior.reservedUsd, prior.accountedUsd);
assert.equal(summary.totalAccountedUsd, prior.accountedUsd + summary.accounting.accountedUsd);
const witnessBytes = await readFile(join(study, prior.witness.artifact));
assert.equal(sha(witnessBytes), prior.witness.sha256);
const witness = JSON.parse(gunzipSync(witnessBytes));
for (const [name, document] of Object.entries(witness.documents)) assert.equal(sha(document.utf8), prior.sourceDocuments[name]);
for (const comparison of summary.comparisons) {
  const pairs = results.rows.filter(a => a.arm === comparison.left && a.fullAuditedSuccess && a.usage.tokensCostReconciled).flatMap(a => {
    const b = results.rows.find(b => b.arm === comparison.right && a.id === b.id && a.repetition === b.repetition && b.fullAuditedSuccess && b.usage.tokensCostReconciled);
    return b ? [[a, b]] : [];
  });
  assert.equal(comparison.pairs, pairs.length); assert.deepEqual(comparison.names, pairs.map(([a, b]) => [a.name, b.name]));
  for (const [metric, fn] of Object.entries({ tokens: r => r.usage.input + r.usage.output, cost: r => r.usage.cost, seconds: r => r.durationMs / 1000 })) {
    const a = pairs.reduce((n, [a]) => n + fn(a), 0), b = pairs.reduce((n, [, b]) => n + fn(b), 0);
    assert.deepEqual(comparison.resources[metric], { left: a, right: b, relativeChange: b ? a / b - 1 : null });
  }
}
assert.equal(summary.completed, results.rows.length); assert.equal(summary.planned, 9);
assert.equal(summary.complete, results.rows.length === 9 && results.rows.every(r => r.review));
if (summary.complete) {
  assert.equal(summary.qualityGate, summary.arms.candidate.audited >= summary.arms.baseline.audited && results.rows.filter(r => r.arm === 'candidate' && r.review.sourceBehaviorPassed).length >= results.rows.filter(r => r.arm === 'baseline' && r.review.sourceBehaviorPassed).length);
  const c = summary.comparisons[0], r = c.resources;
  assert.equal(summary.resourceGate, c.pairs > 0 && (r.tokens.relativeChange <= -.1 || r.cost.relativeChange <= -.1) && r.cost.relativeChange <= .05 && r.seconds.relativeChange <= .1);
}
console.log(JSON.stringify({ paidRequests: 0, completed: results.rows.length, reviewed: review.decisions.length,
  phaseObservedUsd: summary.accounting.observedUsd, phaseReservedUsd: summary.accounting.reservedUsd,
  totalAccountedUsd: summary.totalAccountedUsd, limitation: 'Byte bindings, registered settings and arithmetic; manual/source validity and independence are not established by this verifier.' }));
