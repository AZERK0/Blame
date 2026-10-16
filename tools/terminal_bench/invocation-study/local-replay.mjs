// Reconstruct the pre-fix execution modules without private study workspaces.
// Requires the repository's normal dependencies and compiled agent runtime.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const repo = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const study = join(repo, 'docs/experiments/light-harness-invocation-f33-2026-10-16');
const output = resolve(process.argv[2] ?? join(repo, '.blame/research/invocation-f33/public-replay'));
const root = await mkdtemp(join(tmpdir(), 'blame-invocation-runtime-'));
const run = (args, environment = {}) => spawnSync(process.execPath, args, { cwd: repo, encoding: 'utf8', timeout: 120000,
  env: { ...process.env, ...environment }, maxBuffer: 4 * 1024 * 1024 });
try {
  const old = JSON.parse(gunzipSync(await readFile(join(study, 'baseline-execution-modules.json.gz'))));
  await cp(join(repo, 'packages/agent-runtime/dist'), join(root, 'dist'), { recursive: true });
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n');
  await symlink(join(repo, 'packages/agent-runtime/node_modules'), join(root, 'node_modules'));
  for (const [file, text] of Object.entries(old)) await writeFile(join(root, 'dist/harness', file), text);
  await mkdir(output, { recursive: true });
  const results = [];
  for (const [arm, runtime] of [['baseline', join(root, 'dist/harness')], ['candidate', join(repo, 'packages/agent-runtime/dist/harness')]]) {
    const proofPath = join(output, arm + '-process.json');
    const proof = run([join(repo, 'tools/terminal_bench/invocation-study/process-proof.mjs'), runtime, proofPath]);
    assert.equal(proof.status, 0, proof.stderr + proof.stdout);
    const evidence = JSON.parse(await readFile(proofPath));
    assert.equal(evidence.truthfulLabels, arm === 'baseline' ? 0 : 3);
    const test = run(['--test', join(repo, 'packages/agent-runtime/dist/harness/project-invocation-display.test.js')], { BLAME_GUIDANCE_RUNTIME: runtime });
    await writeFile(join(output, arm + '-controls.tap'), test.stdout + test.stderr);
    assert.equal(test.status, arm === 'baseline' ? 1 : 0, test.stdout + test.stderr);
    results.push({ arm, labels: evidence.truthfulLabels, labelsTotal: evidence.total, controlsExitCode: test.status, lifecycle: evidence.lifecycle });
  }
  assert.deepEqual(results[0].lifecycle, results[1].lifecycle);
  await writeFile(join(output, 'summary.json'), JSON.stringify({ paidRequests: 0, results, lifecycleUnchanged: true }, null, 2) + '\n');
  console.log(JSON.stringify({ paidRequests: 0, labels: results.map(r => [r.arm, r.labels, r.labelsTotal]), lifecycleUnchanged: true }));
} finally { await rm(root, { recursive: true, force: true }); }
