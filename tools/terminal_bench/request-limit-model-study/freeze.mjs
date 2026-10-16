// One executable-module ablation. Both variants share the new factory wiring;
// the reference restores the pre-fix helper that ignores its optional cap.
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { repo, work, study } from './paths.mjs';
const sha = b => createHash('sha256').update(b).digest('hex');
const p = JSON.parse(await readFile(join(study, 'protocol.json')));
const old = JSON.parse(gunzipSync(await readFile(join(repo, 'docs/experiments/light-harness-request-limits-f35-2026-10-16/baseline-modules.json.gz'))));
const patch = await readFile(join(study, 'candidate.patch')), versions = [];
for (const arm of ['baseline', 'candidate']) {
  const root = join(work, 'frozen/f36', arm); await mkdir(root, { recursive: true });
  for (const name of ['agent-runtime', 'benchmark-runner']) {
    const dist = join(root, name, 'dist');
    await cp(join(repo, 'packages', name, 'dist'), dist, { recursive: true, errorOnExist: true, force: false });
    await writeFile(join(root, name, 'package.json'), '{"type":"module","exports":"./dist/index.js"}\n', { flag: 'wx' });
    if (name === 'agent-runtime') {
      if (arm === 'baseline') await writeFile(join(dist, 'provider-schema-compatibility.js'), old['provider-schema-compatibility.js']);
      await symlink(join(repo, 'packages/agent-runtime/node_modules'), join(root, name, 'node_modules'));
    } else {
      await mkdir(join(root, name, 'node_modules/@blame'), { recursive: true });
      await symlink(join(root, 'agent-runtime'), join(root, name, 'node_modules/@blame/agent-runtime'));
    }
  }
  const version = { arm, sourceCommit: p.candidateCommit, sharedFactoryWiringCommit: p.candidateCommit,
    referenceHelperSourceCommit: p.baseCommit, patchSha256: sha(arm === 'baseline' ? '' : patch),
    method: 'Common current runtime; baseline overlays only the archived pre-fix helper. The shared factory passes the configured ceiling; only candidate applies it to Codex HTTP.' };
  versions.push(version); await writeFile(join(root, 'version.json'), JSON.stringify(version, null, 2) + '\n', { flag: 'wx' });
}
const baseline = join(work, 'frozen/f36/baseline/agent-runtime/dist');
const candidate = join(work, 'frozen/f36/candidate/agent-runtime/dist');
const different = [];
for (const e of await readdir(baseline, { recursive: true, withFileTypes: true })) if (e.isFile()) {
  const relative = join(e.parentPath ?? e.path, e.name).slice(baseline.length + 1);
  if (sha(await readFile(join(baseline, relative))) !== sha(await readFile(join(candidate, relative)))) different.push(relative);
}
assert.deepEqual(different, ['provider-schema-compatibility.js']);
await writeFile(join(study, 'variant-sources.json'), JSON.stringify(versions, null, 2) + '\n', { flag: 'wx' });
await writeFile(join(study, 'isolation-controls.json'), JSON.stringify({ paidRequests: 0,
  differentExecutableFiles: different, fixedPromptsAndSchemas: true,
  treatment: 'Only explicit per-request cap restoration. No semantic-tool,edit,admission or default-cap change.'
}, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ differentExecutableFiles: different, assignments: p.order.length }));
