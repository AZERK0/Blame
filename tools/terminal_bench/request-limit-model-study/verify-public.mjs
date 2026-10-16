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
import { evaluateCapContract } from './cap-contract.mjs';
const study = resolve(process.argv[2] ?? defaultStudy);
const json = async name => JSON.parse(await readFile(join(study, name)));
const sha = b => createHash('sha256').update(b).digest('hex');
const p = await json('protocol.json'), launch = await json('launch-registration.json');
assert.equal(launch.protocolSha256, sha(await readFile(join(study, 'protocol.json'))));
assert.equal(p.order.length, 12); assert.equal(p.repetitions, 3);
assert.deepEqual(p.arms, ['baseline', 'candidate', 'cline', 'cline-cap']);
assert.equal(p.studyKind, 'effective-request-output-cap-known-diagnostic');
const results = await json('results.json'), summary = await json('summary.json');
assert.equal(results.provenance.protocolSha256, launch.protocolSha256);
assert.deepEqual(results.provenance.order, p.order);
assert.deepEqual(results.provenance.frozen, await json('execution-bindings.json'));
const review = await json('source-review.json'), inventory = await json('inventory.json');
const noteCorrections = await json('review-note-corrections.json');
for (const [index, correction] of noteCorrections.corrections.entries()) {
  const next = noteCorrections.corrections.slice(index + 1).find(c => c.name === correction.name);
  assert.equal(next?.originalNotes ?? review.decisions.find(d => d.name === correction.name)?.notes, correction.correctedNotes);
  assert.notEqual(correction.originalNotes, correction.correctedNotes);
}
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
  assert.deepEqual(row.metrics, result.metrics ?? null);
  assert.deepEqual(row.completion, result.completion ?? null);
  assert.equal(row.error, result.error ?? null);
  assert.equal(row.independentFunctionalSuccess, JSON.parse(files['score.json']).independentFunctionalSuccess);
  const usage = reconcileUsage(result.usage, events.filter(e => e.type === 'usage').map(e => e.payload?.usage), events.filter(e => e.type === 'notice' && e.payload?.message === 'Agent iteration started.').length);
  assert.deepEqual(row.usage, usage);
  wire[row.name] = files['wire-contracts.jsonl'].toString().trim().split('\n').filter(Boolean).map(JSON.parse);
  for (const request of wire[row.name]) {
    assert.equal(request.model, p.model); assert.equal(request.reasoning?.effort, p.effort); assert.equal(request.byteLimit, p.budgets.maximumSerializedRequestBytes);
    const toolText = files['schema-' + request.toolsSha256 + '.json']?.toString();
    const promptText = files['prompt-' + request.promptSha256 + '.json']?.toString();
    assert.ok(toolText?.endsWith('\n') && promptText?.endsWith('\n'));
    assert.equal(sha(toolText.slice(0, -1)), request.toolsSha256);
    assert.equal(sha(promptText.slice(0, -1)), request.promptSha256);
    const workspace = JSON.parse(files['score.json']).build.cwd;
    const normalized = JSON.stringify({ tools: JSON.parse(toolText), prompt: JSON.parse(promptText) }, (_key, value) => typeof value === 'string' ? value.replaceAll(workspace, '<WORKSPACE>') : value);
    assert.equal(sha(normalized), request.normalizedContractSha256);
  }
  const capContract = evaluateCapContract(row.arm, wire[row.name], row.usage.perRequest, p.budgets.requestMaxOutputTokens);
  assert.ok(files['cap-contract.json'], 'Missing per-trial instrumentation receipt');
  assert.deepEqual(JSON.parse(files['cap-contract.json']), capContract);
  assert.equal(capContract.passed, true, 'Invalid actual request cap');
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
    if (row.exit.orchestrationInterrupted) {
      assert.ok(files['orchestration-interruption.json']);
      const receipt = JSON.parse(files['orchestration-interruption.json']);
      assert.equal(receipt.modelRetried, false); assert.equal(receipt.actualExitStatus, null);
      assert.deepEqual(receipt.sourceBeforeAndAfterGrading, JSON.parse(files['score.json']).sourceSha256);
    } else {
      assert.ok(files['model-exit.json'] && (row.exit.watchdog || row.exit.code !== 0));
      assert.deepEqual(JSON.parse(files['model-exit.json']).exit, row.exit);
    }
  }
}
assert.deepEqual(await json('exposure.json'), exposures);
const initialContracts=results.rows.map(r=>{const q=wire[r.name].find(q=>!q.budgetRejected);return{name:r.name,arm:r.arm,normalizedContractSha256:q?.normalizedContractSha256??null,toolsSha256:q?.toolsSha256??null,promptSha256:q?.promptSha256??null};});
assert.deepEqual(summary.initialContracts,initialContracts);
assert.deepEqual(summary.initialContractAgreement,Object.fromEntries([['light',r=>p.lightArms.includes(r.arm)],['native',r=>r.arm.startsWith('cline')]].map(([family,select])=>{const initial=initialContracts.filter(select);return[family,{observed:initial.filter(r=>r.normalizedContractSha256!==null).length,missing:initial.filter(r=>r.normalizedContractSha256===null).length,distinctNormalizedContracts:[...new Set(initial.map(r=>r.normalizedContractSha256).filter(Boolean))].length}];})));
assert.deepEqual(summary.requestCapContracts, results.rows.map(r => ({ name: r.name,
  ...evaluateCapContract(r.arm, wire[r.name], r.usage.perRequest, p.budgets.requestMaxOutputTokens),
  outputReports: r.usage.perRequest.length,
  maximumObservedOutput: r.usage.perRequest.some(u => typeof u.output === 'number') ? Math.max(...r.usage.perRequest.filter(u => typeof u.output === 'number').map(u => u.output)) : null,
  outputsAtCap: r.usage.perRequest.filter(u => u.output === p.budgets.requestMaxOutputTokens).length })));
for (const arm of p.arms) {
  const a = summary.arms[arm], rows = results.rows.filter(r => r.arm === arm);
  assert.equal(a.assigned, 3); assert.equal(a.completed, rows.length);
  for (const [key, field] of [['official', 'officialRuntimeSuccess'], ['endpoint', 'independentFunctionalSuccess'], ['audited', 'fullAuditedSuccess']]) assert.equal(a[key], rows.filter(r => r[field]).length);
  assert.equal(a.unreviewed, rows.filter(r => r.fullAuditedSuccess === null).length);
  assert.equal(a.tokensObserved, rows.reduce((n, r) => n + (r.usage.input ?? 0) + (r.usage.output ?? 0), 0));
  assert.equal(a.costUsdObserved, rows.reduce((n, r) => n + (r.usage.cost ?? 0), 0));
  const partial = rows.filter(r => r.usage.cost === null);
  assert.equal(a.partialTokensObserved, partial.reduce((n, r) => n + r.usage.perRequest.reduce((n, u) => n + (u.input ?? 0) + (u.output ?? 0), 0), 0));
  assert.equal(a.partialCostUsdObserved, partial.reduce((n, r) => n + r.usage.perRequest.reduce((n, u) => n + (u.cost ?? 0), 0), 0));
  assert.equal(a.workerSeconds, rows.reduce((n, r) => n + (r.durationMs ?? 0), 0) / 1000);
  assert.equal(a.missingConsumption, rows.filter(r => r.usage.input === null || r.usage.output === null || r.usage.cost === null).length);
  assert.equal(a.missingWorkerTime, rows.filter(r => r.durationMs === null).length);
  for (const [field, prefix] of [['cacheRead', 'cacheRead'], ['cacheWrite', 'cacheWrite']]) assert.equal(a[prefix + 'AggregateObserved'], rows.reduce((n, r) => n + (r.usage[field] ?? 0), 0));
  assert.equal(a.missingCacheReadAggregates, rows.filter(r => r.usage.cacheRead === null).length);
  assert.equal(a.missingCacheWriteAggregates, rows.filter(r => r.usage.cacheWrite === null).length);
  assert.equal(a.projectCalls, exposures.filter(e => e.name.endsWith('-' + arm)).reduce((n, e) => n + e.projectCalls.length, 0));
}
const scheduled = reserveTrialCosts(results.rows, wire, p.budgets);
for (const arm of p.arms) {
  const rows = results.rows.filter(r => r.arm === arm), a = summary.arms[arm];
  assert.equal(a.incompleteTokenCostAccounting, rows.filter(r => !r.usage.tokensCostReconciled || scheduled.trials.find(t=>t.name===r.name).wireUsageCountGap > 0).length);
  assert.equal(a.unreportedForwardingAttempts, scheduled.trials.filter(t=>rows.some(r=>r.name===t.name)).reduce((n,t)=>n+t.wireUsageCountGap,0));
}
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
if (results.rows.length === p.order.length) {
  const originalExit = await json('original-driver-exit.json');
  assert.equal(originalExit.accountedNewUsd, scheduled.accountedUsd);
  assert.equal(originalExit.completed, results.rows.length);
}
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
assert.equal(summary.completed, results.rows.length); assert.equal(summary.planned, 12);
assert.equal(summary.complete, results.rows.length === 12 && results.rows.every(r => r.review));
assert.deepEqual(summary.comparisons.map(c => [c.left, c.right]), [['candidate', 'baseline'], ['cline-cap', 'cline'], ['candidate', 'cline-cap']]);
const quality = (left,right) => summary.complete ? summary.arms[left].audited >= summary.arms[right].audited && results.rows.filter(r=>r.arm===left&&r.review.sourceBehaviorPassed).length >= results.rows.filter(r=>r.arm===right&&r.review.sourceBehaviorPassed).length : null;
const resource = c => { if (!summary.complete) return null; const r=c.resources;return c.pairs>0&&(r.tokens.relativeChange<=-.1||r.cost.relativeChange<=-.1)&&r.cost.relativeChange<=.05&&r.seconds.relativeChange<=.1; };
assert.deepEqual(summary.qualityGates, {light:quality('candidate','baseline'),native:quality('cline-cap','cline')});
assert.deepEqual(summary.resourceGates, {light:resource(summary.comparisons[0]),native:resource(summary.comparisons[1])});
assert.equal(summary.qualityGate, summary.complete ? Object.values(summary.qualityGates).every(Boolean) : null);
assert.equal(summary.resourceGate, summary.complete ? Object.values(summary.resourceGates).every(Boolean) : null);
const sensitivity = await json('apparent-validation-sensitivity.json');
const relaxed = results.rows.filter(r => !r.fullAuditedSuccess && r.officialRuntimeSuccess && r.independentFunctionalSuccess && r.review?.sourceBehaviorPassed && r.review?.noSolutionRetrieval && r.review?.semicolonEvidenceSensitivity === true && r.review.criteriaFailures.length === 1 && r.review.criteriaFailures[0] === 'earlier_check_exit_statuses_not_established_by_semicolon_chain').map(r => r.name);
assert.deepEqual(sensitivity.relaxedTrials, relaxed);
assert.deepEqual(sensitivity.acceptedCounts, Object.fromEntries(p.arms.map(arm => [arm, results.rows.filter(r => r.arm === arm && (r.fullAuditedSuccess || relaxed.includes(r.name))).length])));
console.log(JSON.stringify({ paidRequests: 0, completed: results.rows.length, reviewed: review.decisions.length,
  phaseObservedUsd: summary.accounting.observedUsd, phaseReservedUsd: summary.accounting.reservedUsd,
  totalAccountedUsd: summary.totalAccountedUsd, limitation: 'Byte bindings, registered settings and arithmetic; manual/source validity and independence are not established by this verifier.' }));
