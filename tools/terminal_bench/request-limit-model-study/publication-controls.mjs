import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { study } from './paths.mjs';
const verifier = fileURLToPath(new URL('./verify-public.mjs', import.meta.url));
const run = path => spawnSync(process.execPath, [verifier, path], { encoding: 'utf8', timeout: 30000 });
assert.equal(run(study).status, 0);
const root = await mkdtemp(join(tmpdir(), 'blame-request-limit-model-controls-'));
const faults = [];
try {
  for (const name of await readdir(study)) await symlink(join(study, name), join(root, name));
  const cases = [
    ['results.json', 'changed observed usage', v => { v.rows[0].usage.cost += .01; }],
    ['results.json', 'fabricated SDK model-request counter', v => { v.rows.find(r=>r.arm==='cline').metrics.context.modelRequests += 1; }],
    ['summary.json', 'fabricated consumption reserve', v => { v.accounting.reservedUsd += .23; }],
    ['summary.json', 'changed partial consumption', v => { v.accounting.partialObservedUsd += .01; }],
    ['results.json', 'changed observed or missing duration', v => { const r=v.rows.find(r=>r.durationMs===null) ?? v.rows[0];r.durationMs=r.durationMs===null?0:r.durationMs+1; }],
    ['summary.json', 'fabricated audited acceptance', v => { v.arms.candidate.audited += 1; }],
    ['summary.json', 'fabricated paired resource saving', v => { v.comparisons[0].resources.cost.relativeChange = -.99; }],
    ['launch-registration.json', 'registration rebound after dispatch', v => { v.protocolSha256 = '0'.repeat(64); }],
    ['summary.json', 'fabricated effective-cap exposure', v => { v.requestCapContracts.find(r=>r.arm==='candidate').forwarded += 1; }],
    ['summary.json', 'fabricated initial-contract agreement', v => { v.initialContractAgreement.light.distinctNormalizedContracts += 1; }],
  ];
  for (const [name, label, mutate] of cases) {
    const value = JSON.parse(await readFile(join(study, name))); mutate(value);
    await unlink(join(root, name)); await writeFile(join(root, name), JSON.stringify(value));
    assert.notEqual(run(root).status, 0, label); faults.push({ fault: label, rejected: true });
    await unlink(join(root, name)); await symlink(join(study, name), join(root, name));
  }
  // Rehashing an archive/inventory must not hide incorrect request settings.
  // Replace the temporary traces symlink before writing anything underneath it.
  await unlink(join(root, 'traces')); await mkdir(join(root, 'traces'));
  for (const name of await readdir(join(study, 'traces')))
    await symlink(join(study, 'traces', name), join(root, 'traces', name));
  const sha = b => createHash('sha256').update(b).digest('hex');
  for (const [label, choose, mutate] of [
    ['rehash cannot hide missing treatment cap', i => i.name.endsWith('-candidate'), q => { q.maximumOutputTokens = null; }],
    ['rehash cannot hide wrong model effort', i => i.name.endsWith('-baseline'), q => { q.reasoning.effort = 'low'; }],
  ]) {
    const inventory = JSON.parse(await readFile(join(study, 'inventory.json')));
    const item = inventory.find(choose);
    assert.ok(item, 'Control requires its registered arm');
    const archive = JSON.parse(gunzipSync(await readFile(join(study, item.artifact))));
    const key = 'wire-contracts.jsonl';
    const requests = Buffer.from(archive.files[key].base64, 'base64').toString().trim().split('\n').map(JSON.parse);
    mutate(requests.find(q => !q.budgetRejected));
    const wire = Buffer.from(requests.map(q => JSON.stringify(q)).join('\n') + '\n');
    archive.files[key] = { sha256: sha(wire), bytes: wire.length, base64: wire.toString('base64') };
    const bytes = gzipSync(JSON.stringify(archive), { mtime: 0 });
    item.sha256 = sha(bytes); item.files[key] = { sha256: sha(wire), bytes: wire.length };
    await unlink(join(root, item.artifact)); await writeFile(join(root, item.artifact), bytes);
    await unlink(join(root, 'inventory.json')); await writeFile(join(root, 'inventory.json'), JSON.stringify(inventory));
    assert.notEqual(run(root).status, 0, label); faults.push({ fault: label, rejected: true });
    await unlink(join(root, item.artifact)); await symlink(join(study, item.artifact), join(root, item.artifact));
    await unlink(join(root, 'inventory.json')); await symlink(join(study, 'inventory.json'), join(root, 'inventory.json'));
  }
} finally { await rm(root, { recursive: true, force: true }); }
console.log(JSON.stringify({ paidRequests: 0, negativeControls: faults,
  limitation: 'Rejects inconsistent accounting/regrading, not a cryptographic signature or independent source adjudication.' }, null, 2));
