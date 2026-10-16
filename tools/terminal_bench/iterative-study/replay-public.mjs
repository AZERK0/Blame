// Rebuild recorded endpoints from public source + original agent diffs only.
// This does not replay agent decisions, admission or recover a task solution.
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { spawnSync, execFileSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repo, study as defaultStudy, work, json, sha } from './setup.mjs';
const options = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
const study = options.study ? resolve(options.study) : defaultStudy;
const rows = (await json(join(study, 'results.json'))).rows;
const output = options.output ? resolve(options.output) : null;
assert.ok(output, 'Use --output=/absolute/result.json; publication is not overwritten');
const root = await mkdtemp(join(tmpdir(), 'light-public-endpoint-'));
try {
  const stage = join(root, 'resources'); await mkdir(join(stage, 'upstream'), { recursive: true });
  await cp(join(defaultStudy, 'preparation/axios-source.tar.gz'), join(stage, 'upstream/axios.tar.gz'));
  await mkdir(join(stage, 'dependencies'));
  let dependencies = options.dependencies ? resolve(options.dependencies) : join(work, 'dependencies/node_modules');
  if (options['install-deps'] === 'true') {
    await cp(join(defaultStudy, 'preparation/dependency-package.json'), join(stage, 'dependencies/package.json'));
    await cp(join(defaultStudy, 'preparation/package-lock.json'), join(stage, 'dependencies/package-lock.json'));
    execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: join(stage, 'dependencies'), stdio: 'ignore' });
    dependencies = join(stage, 'dependencies/node_modules');
  } else await symlink(dependencies, join(stage, 'dependencies/node_modules'));
  const bootstrap = join(root, 'bootstrap'); await mkdir(bootstrap);
  let setup = await readFile(join(import.meta.dirname, 'setup.mjs'), 'utf8');
  setup = setup.replace("export const repo = resolve(import.meta.dirname, '../../..');", `export const repo = ${JSON.stringify(repo)};`)
    .replace("export const work = join(repo, '.blame/research/iterative-f38');", `export const work = ${JSON.stringify(stage)};`);
  await writeFile(join(bootstrap, 'setup.mjs'), setup);
  for (const name of ['feature', 'regression']) await cp(join(import.meta.dirname, name + '.mjs'), join(bootstrap, name + '.mjs'));
  const { prepare } = await import(pathToFileURL(join(bootstrap, 'setup.mjs')).href);
  const records = [];
  for (const row of rows) {
    const archive = await readFile(join(study, 'traces', row.name + '.json.gz')); assert.equal(sha(archive), row.traceSha256);
    const trace = JSON.parse(gunzipSync(archive));
    const original = name => { const data = Buffer.from(trace.files[name].base64, 'base64'); assert.equal(sha(data), trace.files[name].sha256); return data; };
    const endpoint = join(root, row.name); await prepare(endpoint, row.task);
    const diff = original('workspace.diff');
    if (diff.length) {
      const applied = spawnSync('git', ['apply', '--binary', '-'], { cwd: endpoint, input: diff });
      assert.equal(applied.status, 0, applied.stderr.toString());
    }
    const score = JSON.parse(original('score.json'));
    const hashes = {};
    for (const path of Object.keys(score.sourceHashes)) {
      const bytes = await readFile(join(endpoint, path)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      hashes[path] = bytes === null ? null : sha(bytes);
    }
    assert.deepEqual(hashes, score.sourceHashes, 'Reconstructed source must equal the recorded endpoint');
    const checks = [];
    for (const label of ['regression', 'feature', 'types']) {
      const checked = spawnSync('npm', ['run', `test:study:${label}`], { cwd: endpoint, encoding: 'utf8', timeout: 30000 });
      const expected = score.checks.find(check => check.argv.at(-1) === `test:study:${label}`);
      assert.equal(checked.status, expected.exitCode, `${row.name}:${label}`);
      checks.push({ label, exitCode: checked.status, stdout: checked.stdout, stderr: checked.stderr });
    }
    for (const [path, expected] of Object.entries(hashes)) {
      const current = await readFile(join(endpoint, path)).then(sha, error => { if (error.code === 'ENOENT') return null; throw error; });
      assert.equal(current, expected, 'Checks must not modify recorded source');
    }
    records.push({ name: row.name, sourceHashes: hashes, checks, matchedRecordedOutcomes: true });
  }
  await writeFile(output, JSON.stringify({ modelRequests: 0, scope: 'Recorded endpoint behavior only, not agent-task or verification-admission replay.', records }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ reconstructed: records.length, allMatched: true, modelRequests: 0 }));
} finally { await rm(root, { recursive: true, force: true }); }
