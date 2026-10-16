// Preserve local controls, the infrastructure-invalid campaign and executable assets.
// No model calls, solution repairs or rewriting of the original campaign results.
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { work, study, json, save, sha } from './setup.mjs';
import { reconcileUsage } from '../corpus/light-study-accounting.mjs';

async function archive(root, target, select = () => true) {
  const files = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name), name = relative(root, path);
    if (!select(name)) continue;
    const bytes = await readFile(path);
    if (process.env.BLAME_API_TOKEN) assert.ok(!bytes.includes(Buffer.from(process.env.BLAME_API_TOKEN)));
    files[name] = { bytes: bytes.length, sha256: sha(bytes), base64: bytes.toString('base64') };
  }
  const bytes = gzipSync(JSON.stringify({ files }), { mtime: 0 });
  await writeFile(join(study, target), bytes);
  return { artifact: target, sha256: sha(bytes), files: Object.fromEntries(Object.entries(files).map(([name, file]) => [name, { bytes: file.bytes, sha256: file.sha256 }])) };
}

await mkdir(join(study, 'local'), { recursive: true });
const logs = [];
for (const entry of await readdir(work)) {
  if (!/^(?:cycle[234]-.+|runtime-(?:final-full|full)|runner-full)\.log$/u.test(entry)) continue;
  const bytes = await readFile(join(work, entry));
  const target = `local/${entry}.gz`, compressed = gzipSync(bytes, { mtime: 0 });
  await writeFile(join(study, target), compressed);
  const totals = Object.fromEntries([...bytes.toString().matchAll(/^# (tests|pass|fail|skipped) (\d+)$/gmu)].map(match => [match[1], Number(match[2])]));
  logs.push({ artifact: target, sha256: sha(compressed), rawSha256: sha(bytes), totals });
}
const initial = await json(join(work, 'campaign-initial/analysis.json'));
const stopped = await json(join(study, 'administrative-stop-initial.json'));
const trials = [], outcomes = [];
for (const entry of stopped.started) {
  const target = `local/initial-${entry.name}.json.gz`;
  const directory = join(work, 'campaign-initial', entry.name);
  trials.push({ name: entry.name, ...await archive(directory, target, name => !name.includes('/')) });
  const raw = await json(join(directory, 'result.json'));
  const events = (await readFile(join(directory, 'events.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse).map(record => record.event);
  const usage = reconcileUsage(raw.usage, events.filter(event => event.type === 'usage').map(event => event.payload?.usage),
    events.filter(event => event.type === 'notice' && event.payload?.message === 'Agent iteration started.').length);
  const wire = await readFile(join(directory, 'wire-contracts.jsonl'), 'utf8').then(text => text.trim().split('\n').filter(Boolean).map(JSON.parse), error => { if (error.code === 'ENOENT') return []; throw error; });
  outcomes.push({ name: entry.name, status: raw.status, error: raw.error ?? null, usage,
    exit: await json(join(directory, 'model-exit.json')).catch(error => { if (error.code === 'ENOENT') return null; throw error; }),
    wire, durationMs: raw.durationMs ?? null });
}
await save(join(study, 'initial-results.json'), { ...initial, outcomes, reconstruction: 'The fourth result had already exited before administrative stop; its missing model-exit was not invented. Its independent score was reconstructed afterwards, without changing source. Original scheduler analysis has three rows; outcomes above retains all four raw results separately. Eight slots were never started.', started: stopped.started.length, unstarted: stopped.unstarted, trials });
await cp(join(work, 'campaign/provenance.json'), join(study, 'launch-provenance.json'));

// F37 published compiled JavaScript, but a runnable snapshot also needs prompts
// and plugin assets. Keep the exact common non-JS files and frozen runner bytes.
const runtime = join(work, 'frozen/reference/agent-runtime/dist');
const assets = await archive(runtime, 'local/common-runtime-assets.json.gz', name => !name.endsWith('.js'));
for (const [name, file] of Object.entries(assets.files)) {
  assert.equal(sha(await readFile(join(work, 'frozen/declarations/agent-runtime/dist', name))), file.sha256);
}
const runner = await archive(join(work, 'frozen/reference/benchmark-runner/dist'), 'local/frozen-runner.json.gz');
await save(join(study, 'local/manifest.json'), { logs, assets, runner,
  scope: 'Local tests/replays only. F39/F40/F41 production changes are not in the F38b model snapshots; the F41 model overlay is separately frozen. Test failures before repair are preserved.' });
console.log(JSON.stringify({ logs: logs.length, initialTrials: trials.length, runtimeAssets: Object.keys(assets.files).length, runnerFiles: Object.keys(runner.files).length }));
