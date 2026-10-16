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
const root = await mkdtemp(join(tmpdir(), 'blame-invocation-model-controls-'));
const faults = [];
try {
  for (const name of await readdir(study)) await symlink(join(study, name), join(root, name));
  const cases = [
    ['results.json', 'changed observed usage', v => { v.rows[0].usage.cost += .01; }],
    ['summary.json', 'removed interruption reserve', v => { v.accounting.reservedUsd = 0; }],
    ['summary.json', 'discarded received partial consumption', v => { v.accounting.partialObservedUsd = 0; }],
    ['results.json', 'missing duration silently changed to zero', v => { v.rows.find(r => r.durationMs === null).durationMs = 0; }],
    ['summary.json', 'fabricated audited acceptance', v => { v.arms.candidate.audited += 1; }],
    ['summary.json', 'fabricated paired resource saving', v => { v.comparisons[0].resources.cost.relativeChange = -.99; }],
    ['launch-registration.json', 'registration rebound after dispatch', v => { v.protocolSha256 = '0'.repeat(64); }],
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
