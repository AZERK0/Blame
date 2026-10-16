import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
    ['summary.json', 'fabricated consumption reserve', v => { v.accounting.reservedUsd += .23; }],
    ['summary.json', 'changed partial consumption', v => { v.accounting.partialObservedUsd += .01; }],
    ['results.json', 'changed observed or missing duration', v => { const r=v.rows.find(r=>r.durationMs===null) ?? v.rows[0];r.durationMs=r.durationMs===null?0:r.durationMs+1; }],
    ['summary.json', 'fabricated audited acceptance', v => { v.arms.candidate.audited += 1; }],
    ['summary.json', 'fabricated paired resource saving', v => { v.comparisons[0].resources.cost.relativeChange = -.99; }],
    ['launch-registration.json', 'registration rebound after dispatch', v => { v.protocolSha256 = '0'.repeat(64); }],
    ['summary.json', 'fabricated effective-cap exposure', v => { v.requestCapContracts.find(r=>r.arm==='candidate').forwarded += 1; }],
  ];
  for (const [name, label, mutate] of cases) {
    const value = JSON.parse(await readFile(join(study, name))); mutate(value);
    await unlink(join(root, name)); await writeFile(join(root, name), JSON.stringify(value));
    assert.notEqual(run(root).status, 0, label); faults.push({ fault: label, rejected: true });
    await unlink(join(root, name)); await symlink(join(study, name), join(root, name));
  }
} finally { await rm(root, { recursive: true, force: true }); }
console.log(JSON.stringify({ paidRequests: 0, negativeControls: faults,
  limitation: 'Rejects inconsistent accounting/regrading, not a cryptographic signature or independent source adjudication.' }, null, 2));
