// Byte/contract/accounting checks; this neither reruns agents nor adjudicates prose.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { repo, study as defaultStudy, sha } from './setup.mjs';
import { reconcileUsage } from '../corpus/light-study-accounting.mjs';
import { reserveTrialCosts } from '../navigation-evidence/budget-accounting.mjs';
const study = resolve(process.argv[2] ?? defaultStudy);
const json = async path => JSON.parse(await readFile(join(study, path)));
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
const inventory = await json('publication-inventory.json');
for (const [name, hash] of Object.entries(inventory)) assert.equal(sha(await readFile(join(study, name))), hash, name);
const p = await json('protocol.json'), s = await json('summary.json'), results = await json('results.json');
const bindings = await json('execution-bindings.json'), launch = await json('launch-provenance.json');
assert.ok(['F38b', 'F41'].includes(p.phase));
assert.equal(p.model, 'gpt-5.6-luna'); assert.equal(p.effort, 'high'); assert.equal(p.provider, 'openai-codex');
assert.equal(p.budgets.requestMaxOutputTokens, 8192); assert.equal(p.budgets.maxIterations, 32); assert.equal(p.budgets.timeoutSeconds, 600);
assert.equal(launch.protocolSha256, sha(await readFile(join(study, 'protocol.json')))); assert.deepEqual(launch.order, p.order);
assert.equal(results.completed, p.order.length); assert.equal(results.planned, p.order.length); assert.equal(results.phase, p.phase);
assert.equal(results.rows.length, p.phase === 'F41' ? 9 : 12);
assert.deepEqual(results.rows.map(({ repeat, task, arm }) => ({ repeat, task, arm })), p.order);
for (const [name, hash] of Object.entries(bindings.files)) {
  if (typeof hash !== 'string') continue;
  const bytes = name === 'pnpm-lock.yaml'
    ? gunzipSync(await readFile(join(study, p.phase === 'F41' ? 'runtime-pnpm-lock.yaml.gz' : 'preparation/runtime-pnpm-lock.yaml.gz')))
    : await readFile(join(name.startsWith('tools/') ? repo : study, name));
  assert.equal(sha(bytes), hash, `Frozen input ${name}`);
}
assert.equal(p.project.sourceArchiveSha256, sha(await readFile(join(defaultStudy, 'preparation/axios-source.tar.gz'))));
assert.equal(p.project.dependencyLockSha256, sha(await readFile(join(defaultStudy, 'preparation/package-lock.json'))));
const reviews = await json('source-review.json'), witnesses = await json('invocation-witnesses.json'), wires = {};
const decode = async (artifact, expected) => {
  const raw = await readFile(join(study, artifact)); if (expected) assert.equal(sha(raw), expected);
  const archive = JSON.parse(gunzipSync(raw)), files = {};
  for (const [name, item] of Object.entries(archive.files)) {
    const bytes = Buffer.from(item.base64, 'base64'); assert.equal(bytes.length, item.bytes); assert.equal(sha(bytes), item.sha256); files[name] = bytes;
  }
  return files;
};
const lines = bytes => (bytes?.toString() ?? '').trim().split('\n').filter(Boolean).map(JSON.parse);
if (p.phase === 'F38b') {
  const local = await json('local/manifest.json');
  for (const log of local.logs) {
    const bytes = await readFile(join(study, log.artifact)); assert.equal(sha(bytes), log.sha256);
    const raw = gunzipSync(bytes); assert.equal(sha(raw), log.rawSha256);
    assert.deepEqual(log.totals, Object.fromEntries([...raw.toString().matchAll(/^# (tests|pass|fail|skipped) (\d+)$/gmu)].map(match => [match[1], Number(match[2])])));
  }
  const initial = await json('initial-results.json'), initialProtocol = await json('initial-protocol.json');
  assert.equal(initial.started, 4); assert.equal(initial.unstarted, 8); assert.equal(initial.outcomes.length, 4); assert.equal(initial.rows.length, 3);
  for (const trial of initial.trials) {
    const files = await decode(trial.artifact, trial.sha256), raw = JSON.parse(files['result.json']);
    const outcome = initial.outcomes.find(outcome => outcome.name === trial.name); assert.equal(outcome.status, raw.status);
    assert.deepEqual(outcome.exit, files['model-exit.json'] ? JSON.parse(files['model-exit.json']) : null);
    assert.deepEqual(outcome.wire, lines(files['wire-contracts.jsonl']));
  }
  assert.equal(initial.outcomes.filter(outcome => outcome.status === 'failed').length, 3);
  assert.equal(initial.outcomes.find(outcome => outcome.name === '1-form-length-declarations').exit, null);
  const initialOutcomes = initialProtocol.order.slice(0, 4).map(slot => initial.outcomes.find(row => row.name === `${slot.repeat}-${slot.task}-${slot.arm}`));
  assert.deepEqual(await json('initial-accounting.json'), reserveTrialCosts(initialOutcomes, Object.fromEntries(initial.outcomes.map(row => [row.name, row.wire])), initialProtocol.budgets));
  const scope = await json('cycle2-historical-replay.json'); assert.equal(scope.modelRequests, 0); assert.equal(scope.records.length, 14);
  for (const arm of ['reference', 'candidate']) {
    const rows = scope.records.filter(row => row.arm === arm); assert.equal(rows.length, 7); assert.ok(rows.every(row => row.status === 'blocked'));
    assert.equal(rows.filter(row => row.reason === 'context_outside_symbol').length, arm === 'reference' ? 0 : 3);
  }
  const observation = await json('cycle3-recorded-replay.json'); assert.equal(observation.modelRequests, 0);
  assert.equal(observation.rows.length, 4);
  for (const row of observation.rows) {
    const source = join(repo, 'docs/experiments/light-harness-request-limits-model-f36-2026-10-16/traces', row.name + '.json.gz');
    const bytes = await readFile(source); assert.equal(sha(bytes), row.originalTraceSha256);
    const archive = JSON.parse(gunzipSync(bytes));
    const events = lines(Buffer.from(archive.files['events.jsonl'].base64, 'base64')).map(row => row.event);
    const wire = lines(Buffer.from(archive.files['wire-contracts.jsonl'].base64, 'base64'));
    const o = row.correctedContext.requestObservations;
    assert.equal(row.correctedContext.modelRequests, null); assert.equal(o.transportAttempts, null); assert.equal(o.completedResponses, null);
    assert.equal(o.iterationStartEvents, events.filter(event => event.type === 'notice' && event.payload?.message === 'Agent iteration started.').length);
    assert.equal(o.usageReportEvents, events.filter(event => event.type === 'usage').length);
    assert.equal(row.independentWireForwardingAttempts, wire.filter(row => !row.budgetRejected).length);
    assert.equal(row.otherMetricsUnchanged, true);
    if (o.inputTokenReportEvents === 0) { assert.equal(row.correctedContext.averageInputTokens, null); assert.equal(row.correctedContext.maximumInputTokens, null); }
  }
}
// Exact executable modules plus common assets reconstruct each measured runtime.
const old = join(repo, 'docs/experiments/light-harness-dependency-declarations-f37-2026-10-16');
const oldReference = JSON.parse(await readFile(join(old, 'reference-runtime.json'))), oldCandidate = JSON.parse(await readFile(join(old, 'candidate-runtime.json')));
assert.equal(sha(await readFile(join(old, 'reference-runtime.tar.gz'))), oldReference.archiveSha256);
assert.equal(sha(await readFile(join(old, 'candidate-overlay.tar.gz'))), oldCandidate.archiveSha256);
const base = oldReference.files, declarations = oldCandidate.files;
const local = JSON.parse(await readFile(join(defaultStudy, 'local/manifest.json')));
const assetFiles = JSON.parse(gunzipSync(await readFile(join(defaultStudy, local.assets.artifact)))).files;
const runnerFiles = JSON.parse(gunzipSync(await readFile(join(defaultStudy, local.runner.artifact)))).files;
for (const [manifest, files] of [[local.assets, assetFiles], [local.runner, runnerFiles]]) {
  assert.equal(sha(await readFile(join(defaultStudy, manifest.artifact))), manifest.sha256);
  for (const [name, file] of Object.entries(files)) {
    const bytes = Buffer.from(file.base64, 'base64'); assert.equal(sha(bytes), file.sha256); assert.equal(bytes.length, file.bytes);
    assert.deepEqual(manifest.files[name], { bytes: bytes.length, sha256: sha(bytes) });
  }
}
const frozen = bindings.files[Object.keys(bindings.files).find(name => name.endsWith('/frozen'))];
const extra = p.phase === 'F41' ? await decode('candidate-overlay.json.gz', (await json('candidate-overlay.json')).sha256) : {};
for (const arm of p.phase === 'F41' ? ['reference', 'compiler'] : ['reference', 'declarations']) {
  const expected = { ...base, ...(arm === 'declarations' || p.phase === 'F41' ? declarations : {}),
    ...Object.fromEntries(Object.entries(assetFiles).map(([name, file]) => [name, file.sha256])),
    ...Object.fromEntries(Object.entries(arm === 'compiler' ? extra : {}).map(([name, bytes]) => [name, sha(bytes)])) };
  const prefix = `${arm}/agent-runtime/dist/`;
  assert.deepEqual(Object.fromEntries(Object.entries(frozen).filter(([name]) => name.startsWith(prefix)).map(([name, hash]) => [name.slice(prefix.length), hash])), expected);
  const runnerPrefix = `${arm}/benchmark-runner/dist/`;
  assert.deepEqual(Object.fromEntries(Object.entries(frozen).filter(([name]) => name.startsWith(runnerPrefix)).map(([name, hash]) => [name.slice(runnerPrefix.length), hash])),
    Object.fromEntries(Object.entries(runnerFiles).map(([name, file]) => [name, file.sha256])));
}
for (const row of results.rows) {
  const files = await decode(`traces/${row.name}.json.gz`, row.traceSha256), parsed = name => JSON.parse(files[name]);
  for (const [name, hash] of Object.entries(row.hashes)) assert.equal(sha(files[name]), hash);
  const raw = parsed('result.json'), score = parsed('score.json'), events = lines(files['events.jsonl']).map(record => record.event);
  assert.equal(row.status, raw.status); assert.equal(row.officialRuntimeSuccess, raw.status === 'succeeded');
  assert.equal(row.durationMs, raw.durationMs); assert.deepEqual(row.metrics, raw.metrics); assert.deepEqual(row.completion, raw.completion ?? null);
  assert.deepEqual(row.error, raw.error ?? null); assert.deepEqual(row.exit, parsed('model-exit.json'));
  assert.equal(files['instruction.txt'].toString(), p.tasks.find(task => task.id === row.task).instruction);
  assert.deepEqual(parsed('required-checks.json'), p.tasks.find(task => task.id === row.task).requiredChecks);
  const usage = reconcileUsage(raw.usage, events.filter(event => event.type === 'usage').map(event => event.payload?.usage),
    events.filter(event => event.type === 'notice' && event.payload?.message === 'Agent iteration started.').length);
  assert.deepEqual(row.usage, usage);
  const tools = events.filter(event => event.type === 'tool').map(event => ({ ...event.payload,
    tool: event.payload.toolCall?.name ?? event.payload.tool, input: event.payload.toolCall?.input ?? event.payload.input })).filter(tool => tool.phase === 'finished');
  assert.deepEqual(parsed('tool-ledger.json'), tools);
  wires[row.name] = lines(files['wire-contracts.jsonl']);
  for (const request of wires[row.name]) {
    assert.equal(request.model, p.model); assert.equal(request.reasoning.effort, p.effort); assert.equal(request.maximumOutputTokens, 8192);
    assert.equal(request.byteLimit, p.budgets.maximumSerializedRequestBytes);
    if (!request.budgetRejected) assert.ok(request.requestBytes <= request.byteLimit);
    for (const field of ['tools', 'prompt']) {
      const hash = request[field + 'Sha256'], content = files[`${field === 'tools' ? 'schema' : 'prompt'}-${hash}.json`];
      assert.equal(sha(content.toString().slice(0, -1)), hash);
    }
    const toolsJson = parsed(`schema-${request.toolsSha256}.json`), prompt = parsed(`prompt-${request.promptSha256}.json`);
    const root = `/workspace/Blame/.blame/research/${p.phase === 'F41' ? 'compiler-check-model-f41' : 'iterative-f38'}/campaign/${row.name}/workspace`;
    const normalized = JSON.stringify({ tools: toolsJson, prompt }, (_key, value) => typeof value === 'string' ? value.replaceAll(root, '<WORKSPACE>') : value);
    assert.equal(sha(normalized), request.normalizedContractSha256);
  }
  assert.ok(usage.perRequest.every(report => report.output === null || report.output <= 8192));
  const forwarded = wires[row.name].filter(request => !request.budgetRejected).length;
  assert.deepEqual(row.contract, { passed: true, forwarded, usageReports: usage.reports, unreported: Math.max(0, forwarded - usage.reports) });
  assert.equal(row.declarationCalls, tools.filter(tool => tool.tool === 'read_code' && tool.input?.view === 'declaration').length);
  assert.equal(row.independentFunctionalSuccess, score.protectedPaths.length === 0 && score.checks.every(check => check.exitCode === 0));
  assert.equal(row.independentFunctionalSuccess, score.independentFunctionalSuccess);
  const decision = reviews.decisions.find(decision => decision.name === row.name); assert.deepEqual(decision.hashes, row.hashes);
  assert.equal(row.auditedCompletion, row.officialRuntimeSuccess && row.independentFunctionalSuccess && decision.sourceBehaviorPassed &&
    decision.finalSourceChecksPassed && decision.noSolutionRetrieval && decision.fullRequestPassed);
  const witness = witnesses.records.find(witness => witness.name === row.name); assert.deepEqual(witness.hashes, row.hashes);
  assert.equal(witness.lastSuccessfulEditIndex, tools.findLastIndex(tool => tool.tool === 'edit_code' && tool.output?.status === 'ok' || tool.tool === 'apply_patch' && tool.output?.success === true));
  for (const required of ['regression', 'feature', 'types']) {
    assert.ok(witness.required[required].length);
    for (const invocation of witness.required[required]) {
      assert.ok(invocation.index > witness.lastSuccessfulEditIndex); assert.equal(invocation.command, `npm run test:study:${required}`);
      const tool = tools[invocation.index];
      if (tool.tool === 'run_task') { assert.equal(tool.output.data.command, invocation.command); assert.equal(tool.output.data.exitCode, 0); }
      else assert.ok(tool.output.some(output => output.query === invocation.command && output.success === true));
    }
  }
  if (p.phase === 'F41' && row.arm === 'compiler') {
    const compiler = tools.filter(tool => tool.tool === 'run_task' && tool.output?.data?.command === 'npm run test:study:types');
    assert.ok(compiler.length); assert.ok(row.completion.satisfied_obligations.includes('check:types'));
    assert.equal(row.completion.verification, 'unverified');
    for (const tool of compiler) {
      assert.equal(tool.output.data.validation.scope, 'invocation_only'); assert.deepEqual(tool.output.data.validation.paths, []);
      assert.equal(tool.output.data.validation.taskKind, 'typecheck'); assert.equal(tool.output.data.check, undefined);
    }
  }
}
const accounting = reserveTrialCosts(results.rows, wires, p.budgets); assert.deepEqual(await json('accounting.json'), accounting); assert.deepEqual(s.accounting, accounting);
const prior = await json('prior-budget.json'); close(prior.observedUsd + prior.reservedUsd, prior.accountedUsd);
if (p.phase === 'F41') {
  const bytes = await readFile(join(repo, prior.parent)); assert.equal(sha(bytes), prior.parentSha256);
  const parentAccounting = JSON.parse(bytes), parentPrior = JSON.parse(await readFile(join(defaultStudy, 'prior-budget.json')));
  assert.deepEqual(prior.previous, parentPrior); close(prior.observedUsd, parentPrior.observedUsd + parentAccounting.observedUsd);
  close(prior.reservedUsd, parentPrior.reservedUsd + parentAccounting.reservedUsd);
} else {
  const bytes = await readFile(join(study, prior.parent)); assert.equal(sha(bytes), prior.parentSha256);
  const initial = JSON.parse(bytes); assert.equal(sha(await readFile(join(repo, prior.earlier.parent))), prior.earlier.parentSha256);
  close(prior.observedUsd, prior.earlier.observedUsd + initial.observedUsd); close(prior.reservedUsd, prior.earlier.reservedUsd + initial.reservedUsd);
}
close(prior.reservedUsd, 2.93); close(s.cumulativeObservedSdkUsd, prior.observedUsd + accounting.observedUsd);
close(s.cumulativeReservedUsd, prior.reservedUsd + accounting.reservedUsd); close(s.cumulativeAccountedUsd, prior.accountedUsd + accounting.accountedUsd);
assert.ok(s.cumulativeAccountedUsd <= p.budgets.sharedStudyObservedCostStopUsd);
for (const arm of p.arms) {
  const rows = results.rows.filter(row => row.arm === arm), a = s.arms[arm];
  assert.equal(a.trials, rows.length);
  for (const [key, field] of [['official', 'officialRuntimeSuccess'], ['independent', 'independentFunctionalSuccess'], ['audited', 'auditedCompletion']]) assert.equal(a[key], rows.filter(row => row[field]).length);
  for (const [key, field] of [['input', 'input'], ['output', 'output'], ['cacheRead', 'cacheRead'], ['cacheWrite', 'cacheWrite'], ['sdkEstimatedUsd', 'cost']]) {
    const total = rows.every(row => row.usage[field] !== null) ? rows.reduce((sum, row) => sum + row.usage[field], 0) : null;
    assert.equal(a[key], total);
  }
  assert.equal(a.tokens, a.input === null || a.output === null ? null : a.input + a.output);
  assert.equal(a.durationMs, rows.reduce((sum, row) => sum + row.durationMs, 0));
  assert.equal(a.missingUsageReceipts, rows.reduce((sum, row) => sum + row.contract.unreported, 0));
  assert.equal(a.receiptedInputOutputCostComplete, rows.every(row => row.contract.unreported === 0 && row.usage.tokensCostReconciled));
  assert.equal(a.cachePerRequestReconciled, rows.every(row => row.usage.reconciliation.cacheRead.matches && row.usage.reconciliation.cacheWrite.matches));
}
const treatment = p.arms.find(arm => !['reference', 'cline'].includes(arm)), delta = (a, b) => a === null || b === null || b === 0 ? null : a / b - 1;
for (const baseline of ['reference', 'cline']) {
  const c = s.comparisons[`${treatment}/${baseline}`];
  const pairs = results.rows.filter(row => row.arm === treatment && row.auditedCompletion).flatMap(row => {
    const other = results.rows.find(other => other.arm === baseline && other.task === row.task && other.repeat === row.repeat && other.auditedCompletion);
    return other ? [[row, other]] : [];
  });
  assert.equal(c.pairs, pairs.length);
  for (const [index, label] of [[0, 'candidate'], [1, 'baseline']]) {
    const rows = pairs.map(pair => pair[index]), known = rows.every(row => row.contract.unreported === 0 && row.usage.tokensCostReconciled);
    assert.deepEqual(c[label], { trials: rows.length, tokens: known ? rows.reduce((sum, row) => sum + row.usage.input + row.usage.output, 0) : null,
      cost: known ? rows.reduce((sum, row) => sum + row.usage.cost, 0) : null, durationMs: rows.reduce((sum, row) => sum + row.durationMs, 0) });
  }
  assert.equal(c.tokenDelta, delta(c.candidate.tokens, c.baseline.tokens)); assert.equal(c.costDelta, delta(c.candidate.cost, c.baseline.cost));
  assert.equal(c.durationDelta, delta(c.candidate.durationMs, c.baseline.durationMs));
  assert.deepEqual(c.pairDetails, pairs.map(([row, other]) => {
    const known = [row, other].every(row => row.contract.unreported === 0 && row.usage.tokensCostReconciled);
    return { repeat: row.repeat, task: row.task, candidate: row.name, baseline: other.name,
      tokenDelta: known ? delta(row.usage.input + row.usage.output, other.usage.input + other.usage.output) : null,
      costDelta: known ? delta(row.usage.cost, other.usage.cost) : null, durationDelta: delta(row.durationMs, other.durationMs) };
  }));
  assert.deepEqual(c.leaveOnePairOut, pairs.length > 2 ? pairs.map(([row]) => {
    const retained = pairs.filter(pair => pair[0] !== row);
    const tokens = index => retained.every(pair => pair[index].contract.unreported === 0 && pair[index].usage.tokensCostReconciled)
      ? retained.reduce((sum, pair) => sum + pair[index].usage.input + pair[index].usage.output, 0) : null;
    return { omitted: row.name, tokenDelta: delta(tokens(0), tokens(1)) };
  }) : []);
}
const comparison = s.comparisons[`${treatment}/reference`];
assert.equal(s.qualityGate, s.arms[treatment].audited >= s.arms.reference.audited);
assert.equal(s.resourceGate, s.qualityGate && s.arms[treatment].audited === s.arms.reference.audited && comparison.pairs >= 2 &&
  comparison.tokenDelta !== null && comparison.tokenDelta < 0 && comparison.costDelta < 0 && comparison.durationDelta <= .1);
const endpoints = await json('endpoint-replay.json'); assert.equal(endpoints.modelRequests, 0); assert.equal(endpoints.records.length, results.rows.length);
for (const endpoint of endpoints.records) {
  const row = results.rows.find(row => row.name === endpoint.name); assert.ok(row);
  const files = await decode(`traces/${row.name}.json.gz`, row.traceSha256), score = JSON.parse(files['score.json']);
  assert.deepEqual(endpoint.sourceHashes, score.sourceHashes); assert.ok(endpoint.matchedRecordedOutcomes);
  for (const check of endpoint.checks) assert.equal(check.exitCode, score.checks.find(original => original.argv.at(-1) === `test:study:${check.label}`).exitCode);
}
console.log(JSON.stringify({ phase: p.phase, trials: results.rows.length, passed: true, modelRequests: 0,
  boundary: 'Checks bytes, recorded execution contracts and arithmetic; source/prose adjudication remains an unblinded manual decision.' }));
