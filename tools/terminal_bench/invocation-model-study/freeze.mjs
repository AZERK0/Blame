// F34 isolates command display. It does not change the actual process invocation.
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { repo, work, study } from './paths.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const protocol = JSON.parse(await readFile(join(study, 'protocol.json')));
const old = JSON.parse(gunzipSync(await readFile(join(repo, 'docs/experiments/light-harness-invocation-f33-2026-10-16/baseline-execution-modules.json.gz'))));
const patch = await readFile(join(study, 'candidate.patch'));
const versions = [];
for (const arm of ['baseline', 'candidate']) {
  const root = join(work, 'frozen/f34', arm);
  await mkdir(root, { recursive: true });
  for (const name of ['agent-runtime', 'benchmark-runner']) {
    const dist = join(root, name, 'dist');
    const from = name === 'agent-runtime' ? join(repo, 'packages/agent-runtime/dist') :
      join(repo, '.blame/research/edit-boundaries-f31/frozen/f31/candidate/benchmark-runner/dist');
    await cp(from, dist, { recursive: true, errorOnExist: true, force: false });
    await writeFile(join(root, name, 'package.json'), '{"type":"module","exports":"./dist/index.js"}\n', { flag: 'wx' });
    if (arm === 'baseline' && name === 'agent-runtime')
      for (const [file, text] of Object.entries(old)) await writeFile(join(dist, 'harness', file), text);
    if (name === 'agent-runtime') await symlink(join(repo, 'packages/agent-runtime/node_modules'), join(root, name, 'node_modules'));
    else {
      await mkdir(join(root, name, 'node_modules/@blame'), { recursive: true });
      await symlink(join(root, 'agent-runtime'), join(root, name, 'node_modules/@blame/agent-runtime'));
    }
  }
  const version = { arm,
    sourceCommit: arm === 'baseline' ? protocol.baseCommit : protocol.candidateCommit,
    patchSha256: sha(arm === 'baseline' ? '' : patch),
    sourceNote: 'Current shared runtime, with only the three archived pre-fix display modules overlaid for baseline. No behavioral core differences.'
  };
  await writeFile(join(root, 'version.json'), JSON.stringify(version, null, 2) + '\n', { flag: 'wx' });
  versions.push(version);
}
const baseline = join(work, 'frozen/f34/baseline/agent-runtime/dist');
const candidate = join(work, 'frozen/f34/candidate/agent-runtime/dist');
const different = [];
for (const entry of await readdir(baseline, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
  const path = join(entry.parentPath ?? entry.path, entry.name).slice(baseline.length + 1);
  if (sha(await readFile(join(baseline, path))) !== sha(await readFile(join(candidate, path)))) different.push(path);
}
different.sort();
assert.deepEqual(different, ['harness/light-task-runner.js', 'harness/managed-test-report.js', 'harness/task-catalog.js']);
await writeFile(join(study, 'isolation-controls.json'), JSON.stringify({ paidRequests: 0,
  differentExecutableFiles: different, fixedPromptsAndSchemas: true, actualProcessInvocationUnchanged: true,
  method: 'Identical runtime trees except the three command-rendering modules; native uses reference runtime. Same known task, runner and protected input files.'
}, null, 2) + '\n', { flag: 'wx' });
await writeFile(join(study, 'variant-sources.json'), JSON.stringify(versions, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ differentExecutableFiles: different, planned: protocol.order.length }));
