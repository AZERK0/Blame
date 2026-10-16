// Local process-level evidence, also runnable against an immutable old runtime.
// No model requests. Never capture environment variables or credentials.
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const [runtimeArgument, outputArgument] = process.argv.slice(2);
if (!runtimeArgument || !outputArgument) throw Error('Usage: process-proof.mjs HARNESS_DIST OUTPUT.json');
const runtime = resolve(runtimeArgument);
const root = await mkdtemp(join(tmpdir(), 'blame-invocation-proof-'));
const spawned = [];
const originalSpawn = childProcess.spawn;
childProcess.spawn = function (executable, args, options) {
  if (options?.cwd === root) spawned.push({ executable, args: [...args] });
  return originalSpawn.call(this, executable, args, options);
};
syncBuiltinESMExports();
const cases = [];
try {
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: {
    prebuild: 'node hook.cjs', build: 'node hook.cjs', postbuild: 'node hook.cjs',
    pretest: 'node hook.cjs', test: 'node --test', posttest: 'node hook.cjs',
    'test:types': 'node hook.cjs',
  } }));
  await writeFile(join(root, 'hook.cjs'), `require('fs').appendFileSync('.blame/lifecycle',JSON.stringify({event:process.env.npm_lifecycle_event,args:process.argv.slice(2)})+'\\n');\n`);
  await writeFile(join(root, 'selected suite.test.cjs'), `require('node:test').test('selected',()=>require('node:assert/strict').ok(true));\n`);
  const { LightWorkspace } = await import(pathToFileURL(join(runtime, 'light-workspace.js')));
  const workspace = new LightWorkspace(root, { sessionId: 'invocation-proof' });
  for (const [task, args] of [['build', []], ['test:types', []], ['test', ['selected suite.test.cjs']]]) {
    const offset = spawned.length;
    const result = await workspace.runTask({ kind: 'project', task, ...(args.length ? { args } : {}) }, {});
    assert.equal(result.status, 'ok', JSON.stringify(result));
    assert.equal(result.data.exitCode, 0, JSON.stringify(result));
    const processes = spawned.slice(offset);
    const actual = processes.find(p => p.executable === 'npm' && p.args[0] === 'run');
    assert.ok(actual, 'Expected actual npm wrapper at spawn boundary');
    assert.deepEqual(actual.args.slice(0, 2), ['run', task]);
    const parsed = childProcess.spawnSync('/bin/sh', ['-c', `set -- ${result.data.command}; printf '%s\\0' "$@"`], { cwd: root, encoding: 'utf8' });
    assert.equal(parsed.status, 0);
    const displayArgv = parsed.stdout.split('\0').slice(0, -1);
    cases.push({ task, returnedCommand: result.data.command, actual, displayMatchesProcess: JSON.stringify(displayArgv) === JSON.stringify([actual.executable, ...actual.args]),
      exitCode: result.data.exitCode, check: result.data.check ?? null, validation: result.data.validation ?? null });
  }
  const lifecycle = (await readFile(join(root, '.blame/lifecycle'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(lifecycle.map(x => x.event), ['prebuild', 'build', 'postbuild', 'test:types', 'pretest', 'posttest']);
  const runtimeHashes = Object.fromEntries(await Promise.all(['task-catalog.js', 'light-task-runner.js', 'managed-test-report.js', 'workspace-command-process.js'].map(async file => [file, createHash('sha256').update(await readFile(join(runtime, file))).digest('hex')])));
  const output = { format: 'blame-invocation-process-proof-v1', paidRequests: 0, node: process.version, platform: process.platform, runtimeHashes, lifecycle, cases,
    truthfulLabels: cases.filter(c => c.displayMatchesProcess).length, total: cases.length,
    limitation: 'Known constructed fixtures; direct child spawn and observed lifecycle, not a model-success comparison or complete environment attestation.' };
  await mkdir(resolve(outputArgument, '..'), { recursive: true });
  await writeFile(outputArgument, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({ truthfulLabels: output.truthfulLabels, total: cases.length, lifecycleEvents: lifecycle.length, paidRequests: 0 }));
} finally {
  childProcess.spawn = originalSpawn;
  syncBuiltinESMExports();
  await rm(root, { recursive: true, force: true });
}
