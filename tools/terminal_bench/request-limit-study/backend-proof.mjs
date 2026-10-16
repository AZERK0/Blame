// Publish the original single feasibility attempt and its explicit accounting.
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { reconcileUsage } from '../corpus/light-study-accounting.mjs';
import { reserveTrialCosts } from '../navigation-evidence/budget-accounting.mjs';
const repo = resolve(new URL('../../..', import.meta.url).pathname);
const study = join(repo, 'docs/experiments/light-harness-request-limits-f35-2026-10-16');
const root = join(repo, '.blame/research/request-limits-f35/probe');
const p = JSON.parse(await readFile(join(study, 'probe-protocol.json')));
const files = {};
for (const name of await readdir(root)) if (/^(?:start|child|exit|result|instruction|events|backend-audit|wire-contracts|prompt-[a-f0-9]+|schema-[a-f0-9]+)\.(?:json|jsonl|txt)$/u.test(name)) {
  const bytes = await readFile(join(root, name));
  for (const [key, value] of Object.entries(process.env)) if (/(?:TOKEN|SECRET|PASSWORD|API_KEY)$/u.test(key) && value?.length >= 12 && bytes.includes(Buffer.from(value))) throw Error('Configured secret detected; publication refused');
  files[name] = { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, base64: bytes.toString('base64') };
}
const text = name => Buffer.from(files[name].base64, 'base64').toString();
const audit = text('backend-audit.jsonl').trim().split('\n').map(JSON.parse);
const wire = text('wire-contracts.jsonl').trim().split('\n').map(JSON.parse);
const result = JSON.parse(text('result.json'));
const events = text('events.jsonl').trim().split('\n').map(JSON.parse).map(e => e.event);
const usage = reconcileUsage(result.usage, events.filter(e => e.type === 'usage').map(e => e.payload?.usage), events.filter(e => e.type === 'notice' && e.payload?.message === 'Agent iteration started.').length);
const terminal = audit.find(e => e.type === 'response_terminal');
const attempts = audit.filter(e => e.type === 'forwarded_attempt');
assert.equal(attempts.length, p.maximumForwardedModelAttempts);
const row = { name: 'f35-cap-feasibility', usage };
const accounting = reserveTrialCosts([row], { [row.name]: wire }, { perTrialSdkCostLimitUsd: p.softSessionCostUsd, requestOvershootReserveUsd: p.missingUsageReserveUsd - p.softSessionCostUsd });
const prior = JSON.parse(await readFile(join(study, 'prior-budget.json')));
const output = { kind: 'backend feasibility, not coding-task success', plannedForwardedAttempts: 1, recordedForwardedAttempts: attempts.length,
  httpStatus: audit.find(e => e.type === 'http_response')?.status ?? null,
  requestedOutputCap: p.injectedOutputCap, originalSdkOutputCap: attempts[0].originalMaximumOutputTokens,
  transmittedOutputCap: wire[0].maximumOutputTokens,
  backendStatus: terminal?.status ?? null, incompleteReason: terminal?.incompleteReason ?? null,
  backendUsage: terminal?.usage ?? null, sdkUsage: usage,
  officialRuntimeStatus: result.status, officialRuntimeError: result.error ?? null,
  acceptedAndEnforced: terminal?.status === 'incomplete' && terminal.incompleteReason === 'max_output_tokens' && terminal.usage?.output_tokens === p.injectedOutputCap,
  accounting, priorObservedUsd: prior.observedUsd, priorReservedUsd: prior.reservedUsd,
  totalObservedUsd: prior.observedUsd + accounting.observedUsd,
  totalReservedUsd: prior.reservedUsd + accounting.reservedUsd,
  totalAccountedUsd: prior.accountedUsd + accounting.accountedUsd,
  decision: 'Host-owned opt-in adapter correction is supported on the tested endpoint/model; validate full SDK transport then compare quality separately.',
  limitation: 'One token-stress diagnostic; expected incomplete model response is not a successful user coding task. SDK costs are estimates, not invoices. Backend/model revision and hidden retries remain unknown.' };
const archive = gzipSync(JSON.stringify({ files }), { mtime: 0 });
await writeFile(join(study, 'backend-probe.json.gz'), archive);
await writeFile(join(study, 'backend-probe-inventory.json'), JSON.stringify({ artifact: 'backend-probe.json.gz', sha256: createHash('sha256').update(archive).digest('hex'), files: Object.fromEntries(Object.entries(files).map(([name, v]) => [name, { sha256: v.sha256, bytes: v.bytes }])) }, null, 2) + '\n');
await writeFile(join(study, 'backend-feasibility.json'), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ acceptedAndEnforced: output.acceptedAndEnforced, outputTokens: terminal?.usage?.output_tokens, sdkObservedUsd: accounting.observedUsd, newReservedUsd: accounting.reservedUsd, totalAccountedUsd: output.totalAccountedUsd }));
