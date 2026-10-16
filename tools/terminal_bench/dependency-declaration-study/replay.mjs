// Offline, known-diagnostic lookup replay; no model, task recovery or token claim.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const repo = resolve(import.meta.dirname, '../../..');
const publication = resolve(repo, 'docs/experiments/light-harness-dependency-declarations-f37-2026-10-16');
const options = Object.fromEntries(process.argv.slice(2).map(value => value.replace(/^--/, '').split('=')));
const output = options.output && resolve(options.output);
assert.ok(output, 'Use --output=/absolute/result.json; existing publication is never silently overwritten');
const dependencies = resolve(options.dependencies ?? join(repo, '.blame/research/edit-boundaries-f31/upstreams/fast-glob/node_modules'));
let candidateModule;
const runtimeDependencies = resolve(options['runtime-dependencies'] ?? join(repo, 'packages/agent-runtime/node_modules'));
const sourceArchive = resolve(repo, 'docs/experiments/light-harness-edit-boundaries-f31-2026-10-16/preparation/fast-glob-source.tar.gz');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const cases = [
  ['src/readers/stream.ts#fsWalk', '@nodelib/fs.walk', 'Settings'],
  ['src/readers/stream.ts#fsWalk.walkStream', '@nodelib/fs.walk', 'walkStream'],
  ['src/readers/async.ts#fsWalk.walk', '@nodelib/fs.walk', 'walk'],
  ['src/readers/sync.ts#fsWalk.walkSync', '@nodelib/fs.walk', 'walkSync'],
  ['src/readers/stream.ts#fsWalk.Options', '@nodelib/fs.walk', 'entryFilter'],
  ['src/readers/reader.ts#fsStat.Settings', '@nodelib/fs.stat', 'Settings'],
];
const temp = await mkdtemp(join(tmpdir(), 'blame-declaration-replay-'));
const referenceManifest = JSON.parse(await readFile(join(publication, 'reference-runtime.json'), 'utf8'));
try {
  const referenceArchive = join(publication, 'reference-runtime.tar.gz');
  assert.equal(hash(await readFile(referenceArchive)), referenceManifest.archiveSha256);
  const reference = join(temp, 'reference');
  await mkdir(reference);
  execFileSync('tar', ['-xzf', referenceArchive, '-C', reference]);
  for (const [path, expected] of Object.entries(referenceManifest.files))
    assert.equal(hash(await readFile(join(reference, 'runtime', path))), expected, path);
  await writeFile(join(reference, 'package.json'), '{"type":"module"}\n');
  await symlink(runtimeDependencies, join(reference, 'node_modules'));
  const candidateManifest = JSON.parse(await readFile(join(publication, 'candidate-runtime.json'), 'utf8'));
  assert.equal(hash(await readFile(join(publication, 'reference-runtime.json'))), candidateManifest.referenceManifestSha256);
  const candidateArchive = join(publication, 'candidate-overlay.tar.gz');
  assert.equal(hash(await readFile(candidateArchive)), candidateManifest.archiveSha256);
  const candidate = join(temp, 'candidate');
  await mkdir(candidate);
  await cp(join(reference, 'runtime'), join(candidate, 'runtime'), { recursive: true });
  execFileSync('tar', ['-xzf', candidateArchive, '-C', candidate]);
  for (const [path, expected] of Object.entries({ ...referenceManifest.files, ...candidateManifest.files }))
    assert.equal(hash(await readFile(join(candidate, 'runtime', path))), expected, path);
  await writeFile(join(candidate, 'package.json'), '{"type":"module"}\n');
  await symlink(runtimeDependencies, join(candidate, 'node_modules'));
  candidateModule = options.candidate ? resolve(options.candidate) : join(candidate, 'runtime/harness/light-workspace.js');
  const modules = {
    reference: await import(pathToFileURL(join(reference, 'runtime/harness/light-workspace.js')).href),
    candidate: await import(pathToFileURL(candidateModule).href),
  };
  const records = [];
  // Rotate order, fresh source/session each arm; three dependent replay repeats.
  for (let repeat = 0; repeat < 3; repeat++) {
    const order = repeat % 2 ? ['candidate', 'reference'] : ['reference', 'candidate'];
    for (const arm of order) {
      const root = join(temp, `${repeat}-${arm}`);
      await mkdir(root);
      execFileSync('tar', ['-xzf', sourceArchive, '-C', root]);
      await symlink(dependencies, join(root, 'node_modules'));
      const workspace = new modules[arm].LightWorkspace(root, { sessionId: `${repeat}-${arm}` });
      for (const [target, expectedPackage, needle] of cases) {
        const input = { target, view: 'declaration' };
        const started = performance.now();
        const response = await workspace.readCode(input, {});
        const durationMs = performance.now() - started;
        const data = response.data;
        const identityMatches = response.status === 'ok' && data?.readOnly === true &&
          data.sources?.every(source => source.package === expectedPackage && /^\d+\./.test(source.version)) &&
          (data.content?.includes(needle) || data.exports?.includes(needle));
        // Cross-check identity hashes against the installed canonical files,
        // independent of the response's own success label.
        if (identityMatches) for (const source of data.sources) {
          assert.equal(hash(await readFile(join(dependencies, source.package, source.path))), source.hash);
          const metadata = await readFile(join(dependencies, source.package, 'package.json'));
          assert.equal(hash(metadata), source.packageHash);
          assert.equal(JSON.parse(metadata).version, source.version);
        }
        records.push({ repeat, arm, input, durationMs, responseBytes: Buffer.byteLength(JSON.stringify(response)),
          identityMatches: Boolean(identityMatches), response });
      }
      const denied = await workspace.readCode({ target: 'node_modules/@nodelib/fs.walk/out/index.d.ts', view: 'raw' }, {});
      assert.equal(denied.status, 'blocked', `${arm}: ordinary dependency read stays blocked`);
    }
  }
  const arms = Object.fromEntries(Object.keys(modules).map(arm => {
    const rows = records.filter(row => row.arm === arm);
    return [arm, { attempts: rows.length, successfulIdentityLookups: rows.filter(row => row.identityMatches).length,
      totalResponseBytes: rows.reduce((sum, row) => sum + row.responseBytes, 0),
      totalDurationMs: rows.reduce((sum, row) => sum + row.durationMs, 0) }];
  }));
  const dependencyIdentity = {};
  for (const name of ['@nodelib/fs.walk', '@nodelib/fs.stat']) {
    const text = await readFile(join(dependencies, name, 'package.json'));
    dependencyIdentity[name] = { version: JSON.parse(text).version, packageHash: hash(text) };
  }
  const report = { scope: 'known-diagnostic local lookup replay; not coding-task success or model-token savings',
    sourceCommit: '48687898dd26d4e935a0e5ecf6720e7c5aeac15d', sourceArchiveSha256: hash(await readFile(sourceArchive)),
    referenceCommit: referenceManifest.sourceCommit, referenceArchiveSha256: referenceManifest.archiveSha256,
    candidateCommit: candidateManifest.sourceCommit, customCandidateOverride: Boolean(options.candidate),
    candidateArchiveSha256: candidateManifest.archiveSha256,
    candidateModuleSha256: hash(await readFile(candidateModule)), nodeVersion: process.version,
    dependencyIdentity, modelRequests: 0, arms, records };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify({ arms, output }) + '\n');
} finally { await rm(temp, { recursive: true, force: true }); }
