// No-model replay of original feasibility receipts, SDK controls and accounting.
// This verifies consistency, not independent source review or backend identity.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { resolve, join } from 'node:path';
import { reconcileUsage } from '../corpus/light-study-accounting.mjs';
import { reserveTrialCosts } from '../navigation-evidence/budget-accounting.mjs';
const root = resolve(process.argv[2] ?? 'docs/experiments/light-harness-request-limits-f35-2026-10-16');
const json = async name => JSON.parse(await readFile(join(root, name)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const p = await json('probe-protocol.json'), f = await json('backend-feasibility.json');
const old = JSON.parse(gunzipSync(await readFile(join(root, 'baseline-modules.json.gz'))));
const oldHashes = await json('baseline-module-hashes.json');
for (const [name, source] of Object.entries(old)) {
  assert.equal(sha(source), oldHashes[name]);
  assert.equal(sha(source), p.inputSha256['packages/agent-runtime/dist/' + name]);
}
const guard = await json('sdk-guard-evidence.json');
assert.equal(guard.llmsModuleSha256, p.inputSha256['packages/agent-runtime/node_modules/@cline/llms/dist/index.js']);
const inventory = await json('backend-probe-inventory.json');
assert.equal(inventory.artifact, 'backend-probe.json.gz');
const bytes = await readFile(join(root, inventory.artifact));
assert.equal(sha(bytes), inventory.sha256);
const archive = JSON.parse(gunzipSync(bytes)), files = {};
for (const [name, file] of Object.entries(archive.files)) {
  const b = Buffer.from(file.base64, 'base64');
  assert.equal(sha(b), file.sha256); assert.equal(b.length, file.bytes);
  assert.deepEqual(inventory.files[name], { sha256: sha(b), bytes: b.length });
  files[name] = b.toString();
}
const start = JSON.parse(files['start.json']);
assert.equal(start.protocolSha256, sha(await readFile(join(root, 'probe-protocol.json'))));
assert.equal(start.gitHead, 'b3618c2a97383208147f0847d9ad886efff8aaea');
assert.equal(p.maximumForwardedModelAttempts, 1); assert.equal(p.injectedOutputCap, 1024);
const lines = name => files[name].trim().split('\n').filter(Boolean).map(JSON.parse);
const audit = lines('backend-audit.jsonl'), wire = lines('wire-contracts.jsonl');
const events = lines('events.jsonl').map(e => e.event), result = JSON.parse(files['result.json']);
const attempts = audit.filter(e => e.type === 'forwarded_attempt'), terminal = audit.find(e => e.type === 'response_terminal');
assert.equal(attempts.length, 1); assert.equal(wire.length, 1);
assert.equal(attempts[0].model, p.model); assert.equal(attempts[0].reasoning.effort, p.effort);
assert.equal(wire[0].model, p.model); assert.equal(wire[0].reasoning.effort, p.effort);
assert.equal(f.recordedForwardedAttempts, attempts.length);
assert.equal(f.httpStatus, audit.find(e => e.type === 'http_response').status);
assert.equal(f.requestedOutputCap, p.injectedOutputCap);
assert.equal(f.originalSdkOutputCap, attempts[0].originalMaximumOutputTokens);
assert.equal(f.transmittedOutputCap, wire[0].maximumOutputTokens);
assert.equal(f.transmittedOutputCap, attempts[0].injectedMaximumOutputTokens);
assert.equal(f.backendStatus, terminal.status); assert.equal(f.incompleteReason, terminal.incompleteReason);
assert.deepEqual(f.backendUsage, terminal.usage);
assert.equal(f.acceptedAndEnforced, terminal.status === 'incomplete' && terminal.incompleteReason === 'max_output_tokens' && terminal.usage.output_tokens === p.injectedOutputCap);
assert.equal(f.officialRuntimeStatus, result.status); assert.equal(f.officialRuntimeError, result.error);
assert.equal(result.status, 'failed'); // Intended stress truncation is not user-task success.
const usage = reconcileUsage(result.usage, events.filter(e => e.type === 'usage').map(e => e.payload?.usage), events.filter(e => e.type === 'notice' && e.payload?.message === 'Agent iteration started.').length);
assert.deepEqual(f.sdkUsage, usage);
const accounting = reserveTrialCosts([{ name: 'f35-cap-feasibility', usage }], { 'f35-cap-feasibility': wire }, { perTrialSdkCostLimitUsd: p.softSessionCostUsd, requestOvershootReserveUsd: p.missingUsageReserveUsd - p.softSessionCostUsd });
assert.deepEqual(f.accounting, accounting);
const prior = await json('prior-budget.json');
assert.equal(f.totalObservedUsd, prior.observedUsd + accounting.observedUsd);
assert.equal(f.totalReservedUsd, prior.reservedUsd + accounting.reservedUsd);
assert.equal(f.totalAccountedUsd, prior.accountedUsd + accounting.accountedUsd);
for (const [name, count] of [['full-sdk-before.json', 2], ['full-sdk-after.json', 3]]) {
  const controls = await json(name);
  assert.equal(controls.paidRequests, 0); assert.equal(controls.total, 3);
  assert.equal(controls.passed, count); assert.equal(controls.rows.filter(r => r.passed).length, count);
  for (const row of controls.rows) {
    assert.equal(row.passed, row.exitCode === 0 && row.output.captures.length === 1 && row.output.captures[0].maximumOutputTokens === row.expected);
  }
}
const local = await json('local-validation.json');
const tap = await readFile(join(root, 'registered-suite.tap'), 'utf8');
const before = await readFile(join(root, 'unit-before.tap'), 'utf8');
const targeted = await readFile(join(root, 'targeted-after.tap'), 'utf8');
for (const [label, count] of [['tests', 8], ['pass', 3], ['fail', 5]])
  assert.ok(new RegExp('(?:# |ℹ )' + label + ' ' + count + '\\b', 'u').test(before), 'Before counter mismatch: ' + label);
for (const [label, count] of [['tests', 108], ['pass', 108], ['fail', 0]])
  assert.ok(new RegExp('(?:# |ℹ )' + label + ' ' + count + '\\b', 'u').test(targeted), 'Targeted counter mismatch: ' + label);
assert.deepEqual(local.unitCapControls, { beforePassed: 3, afterPassed: 8, total: 8 });
assert.deepEqual(local.targetedRuntimeProviderAndProduction, { passed: 108, failed: 0 });
for (const name of [
  'an explicitly configured cap reaches a Codex request whose gateway omitted it',
  'a stricter existing cap is preserved and a larger cap is reduced',
  'unconfigured output behavior and other origins/endpoints remain unchanged',
  'Request bodies retain credentials and signal while rewritten content length is recomputed',
  'invalid configured limits fail before any transport invocation',
  'malformed or uninspectable capped model requests cannot bypass the budget',
  'abort is preserved and an explicit null signal retains fetch override semantics',
  'non-inference GET requests do not acquire a model body',
]) assert.ok(targeted.includes('✔ ' + name + ' ('), 'Missing passing cap case: ' + name);
for (const [label, count] of [['tests', 877], ['pass', 875], ['fail', 0], ['skipped', 2]])
  assert.ok(new RegExp('(?:# |ℹ )' + label + ' ' + count + '\\b', 'u').test(tap), 'Registered suite counter mismatch: ' + label);
assert.deepEqual(local.registeredPackageSuite, { files: 65, cases: 877, passed: 875, skipped: 2, failed: 0 });
console.log(JSON.stringify({ paidRequests: 0, acceptedAndEnforced: f.acceptedAndEnforced, fullSdkControls: '2/3 -> 3/3', observedUsd: accounting.observedUsd, totalAccountedUsd: f.totalAccountedUsd }));
