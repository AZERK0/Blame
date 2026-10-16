import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const study = resolve('docs/experiments/light-harness-request-limits-f35-2026-10-16');
const verifier = fileURLToPath(new URL('./verify-public.mjs', import.meta.url));
const run = path => spawnSync(process.execPath, [verifier, path], { encoding: 'utf8', timeout: 30000 });
assert.equal(run(study).status, 0);
const root = await mkdtemp(join(tmpdir(), 'blame-cap-probe-controls-')), faults = [];
try {
  for (const name of await readdir(study)) await symlink(join(study, name), join(root, name));
  const cases = [
    ['backend-feasibility.json', 'fabricated backend output count', v => { v.backendUsage.output_tokens += 1; }],
    ['backend-feasibility.json', 'promoted stress truncation to task success', v => { v.officialRuntimeStatus = 'succeeded'; }],
    ['backend-feasibility.json', 'removed prior reserves', v => { v.totalReservedUsd = 0; }],
    ['backend-feasibility.json', 'fabricated SDK cost', v => { v.sdkUsage.cost = 0; }],
    ['full-sdk-after.json', 'configured cap silently missing', v => { v.rows[0].output.captures[0].maximumOutputTokens = null; }],
    ['probe-protocol.json', 'changed preregistered cap after dispatch', v => { v.injectedOutputCap = 2048; }],
  ];
  for (const [name, label, mutate] of cases) {
    const value = JSON.parse(await readFile(join(study, name))); mutate(value);
    await unlink(join(root, name)); await writeFile(join(root, name), JSON.stringify(value));
    assert.notEqual(run(root).status, 0, label); faults.push({ fault: label, rejected: true });
    await unlink(join(root, name)); await symlink(join(study, name), join(root, name));
  }
} finally { await rm(root, { recursive: true, force: true }); }
console.log(JSON.stringify({ paidRequests: 0, negativeControls: faults,
  limitation: 'Consistency controls, not signed provenance or independent backend adjudication.' }, null, 2));
