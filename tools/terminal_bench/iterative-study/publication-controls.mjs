// Corrupt disposable copies, including coherently rehashed archives. Never edits
// original trial bytes. Passing means the verifier rejects these errors only.
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inventory } from './inventory.mjs';
import { repo, study as parent, sha, json, save } from './setup.mjs';
const child = join(repo, 'docs/experiments/light-harness-compiler-check-model-f41-2026-10-16');
const root = await mkdtemp(join(tmpdir(), 'light-publication-controls-')), controls = [];
async function changeJson(directory, name, change) {
  const document = await json(join(directory, name)); await change(document); await save(join(directory, name), document);
}
async function changeTrace(directory, change) {
  const results = await json(join(directory, 'results.json'));
  const row = results.rows.find(row => row.arm === 'compiler') ?? results.rows[0];
  const path = join(directory, 'traces', row.name + '.json.gz');
  const archive = JSON.parse(gunzipSync(await readFile(path)));
  const read = name => JSON.parse(Buffer.from(archive.files[name].base64, 'base64'));
  const set = (name, bytes) => { archive.files[name] = { bytes: bytes.length, sha256: sha(bytes), base64: bytes.toString('base64') }; };
  const setJson = (name, value) => set(name, Buffer.from(JSON.stringify(value) + '\n'));
  await change({ row, archive, read, set, setJson });
  for (const name of Object.keys(row.hashes)) row.hashes[name] = archive.files[name].sha256;
  const raw = gzipSync(JSON.stringify(archive), { mtime: 0 }); row.traceSha256 = sha(raw); await writeFile(path, raw);
  await save(join(directory, 'results.json'), results);
  await changeJson(directory, 'source-review.json', document => { document.decisions.find(decision => decision.name === row.name).hashes = row.hashes; });
  await changeJson(directory, 'invocation-witnesses.json', document => { document.records.find(record => record.name === row.name).hashes = row.hashes; });
}
const cases = [
  ['missing_assignment', parent, directory => changeJson(directory, 'results.json', document => { document.rows.pop(); }), /AssertionError/u],
  ['wire_cap_rehashed', parent, directory => changeTrace(directory, ({ archive, set }) => {
    const rows = Buffer.from(archive.files['wire-contracts.jsonl'].base64, 'base64').toString().trim().split('\n').map(JSON.parse);
    rows[0].maximumOutputTokens = 4096; set('wire-contracts.jsonl', Buffer.from(rows.map(JSON.stringify).join('\n') + '\n'));
  }), /8192/u],
  ['wire_effort_rehashed', parent, directory => changeTrace(directory, ({ archive, set }) => {
    const rows = Buffer.from(archive.files['wire-contracts.jsonl'].base64, 'base64').toString().trim().split('\n').map(JSON.parse);
    rows[0].reasoning.effort = 'low'; set('wire-contracts.jsonl', Buffer.from(rows.map(JSON.stringify).join('\n') + '\n'));
  }), /high/u],
  ['forged_aggregate_usage', parent, directory => changeTrace(directory, ({ read, setJson }) => {
    const result = read('result.json'); result.usage.aggregateUsage.totalInputTokens += 1; setJson('result.json', result);
  }), /AssertionError/u],
  ['receipt_zero_is_not_transport_zero', parent, directory => changeJson(directory, 'cycle3-recorded-replay.json', document => { document.rows.at(-1).correctedContext.modelRequests = 0; }), /null/u],
  ['dropped_prior_reserve', child, async directory => {
    await changeJson(directory, 'prior-budget.json', document => { document.reservedUsd = 0; document.accountedUsd = document.observedUsd; });
  }, /2\.93|Frozen input/u],
  ['compiler_scope_rehashed', child, directory => changeTrace(directory, ({ archive, set, setJson }) => {
    const records = Buffer.from(archive.files['events.jsonl'].base64, 'base64').toString().trim().split('\n').map(JSON.parse);
    for (const { event } of records) {
      if (event.type !== 'tool' || event.payload.phase !== 'finished') continue;
      const output = event.payload.output ?? event.payload.result;
      if (output?.data?.command === 'npm run test:study:types') { output.data.validation.scope = 'project'; output.data.validation.paths = ['.']; }
    }
    set('events.jsonl', Buffer.from(records.map(JSON.stringify).join('\n') + '\n'));
    const ledger = records.map(record => record.event).filter(event => event.type === 'tool').map(event => ({ ...event.payload,
      tool: event.payload.toolCall?.name ?? event.payload.tool, input: event.payload.toolCall?.input ?? event.payload.input })).filter(tool => tool.phase === 'finished');
    setJson('tool-ledger.json', ledger);
  }), /invocation_only/u],
  ['fabricated_source_verification', child, directory => changeTrace(directory, ({ row, read, setJson }) => {
    const result = read('result.json'); result.completion.verification = 'verified'; row.completion = result.completion; setJson('result.json', result);
  }), /unverified/u],
];
try {
  for (const [name, source, corrupt, expected] of cases) {
    const directory = join(root, name); await cp(source, directory, { recursive: true }); await corrupt(directory); await inventory(directory);
    const run = spawnSync(process.execPath, [join(import.meta.dirname, 'verify-public.mjs'), directory], { encoding: 'utf8' });
    assert.notEqual(run.status, 0, name); assert.match(run.stderr, expected, name);
    controls.push({ name, coherentlyRehashed: true, rejected: true, verifierExitCode: run.status });
  }
  await save(join(parent, 'publication-controls.json'), { modelRequests: 0, controls, limitation: 'Finite corruption controls do not prove that arbitrary coherent rewriting of all evidence can be detected. Original bytes and git history remain the provenance boundary.' });
  console.log(JSON.stringify({ controls: controls.length, passed: true, modelRequests: 0 }));
} finally { await rm(root, { recursive: true, force: true }); }
