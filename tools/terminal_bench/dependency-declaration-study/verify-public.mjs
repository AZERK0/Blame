import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = resolve(import.meta.dirname, '../../..');
export const publication = join(repo, 'docs/experiments/light-harness-dependency-declarations-f37-2026-10-16');
const hash = value => createHash('sha256').update(value).digest('hex');
export async function verify(directory = publication) {
  const read = path => readFile(join(directory, path));
  const json = async path => JSON.parse(await read(path));
  const inventory = await json('inventory.json');
  for (const [path, expected] of Object.entries(inventory)) assert.equal(hash(await read(path)), expected, path);
  const reference = await json('reference-runtime.json'), candidate = await json('candidate-runtime.json');
  assert.equal(reference.sourceCommit, '8ceb9139');
  assert.equal(hash(await read('reference-runtime.tar.gz')), reference.archiveSha256);
  assert.equal(hash(await read('candidate-overlay.tar.gz')), candidate.archiveSha256);
  assert.equal(hash(await read('reference-runtime.json')), candidate.referenceManifestSha256);
  assert.equal(candidate.sourceCommit.slice(0, 8), '464f2e04');
  const validation = await json('validation.json');
  assert.equal(validation.implementationCommit, candidate.sourceCommit);
  assert.equal(validation.build.exitCode, 0); assert.equal(validation.lint.exitCode, 0);
  for (const [key, expected] of Object.entries({ localPanelFirst: [15, 12, 3], localPanelSecond: [15, 15, 0],
    targetedFinal: [52, 52, 0], registeredSuite: [893, 891, 0] })) {
    const record = validation[key];
    assert.deepEqual([record.tests, record.passed, record.failed], expected, key);
    const log = (await read(record.log)).toString();
    for (const [field, value] of [['tests', record.tests], ['pass', record.passed], ['fail', record.failed]])
      assert.match(log, new RegExp(`(?:# |ℹ )${field} ${value}(?:\\r?\\n|$)`));
  }
  assert.equal(validation.newModelRequests, 0); assert.equal(validation.newSdkEstimatedUsd, 0);
  assert.equal(validation.cumulative.accountedUsd, 6.62580432);
  assert.equal(validation.cumulative.observedSdkEstimatedUsd, 4.68580432);
  assert.equal(validation.cumulative.missingUsageReserveUsd, 1.94);
  assert.ok(Math.abs(validation.cumulative.observedSdkEstimatedUsd + validation.cumulative.missingUsageReserveUsd - validation.cumulative.accountedUsd) < 1e-9);
  const schema = await json('schema-overhead.json');
  assert.equal(schema.modelRequests, 0); assert.equal(schema.deltaBytes, 516);
  assert.equal(schema.arms.candidate.totalBytes - schema.arms.reference.totalBytes, 516);
  for (const name of ['search_code', 'edit_code', 'run_task'])
    assert.deepEqual(schema.arms.reference.tools[name], schema.arms.candidate.tools[name]);
  assert.equal(schema.arms.candidate.tools.read_code.bytes - schema.arms.reference.tools.read_code.bytes, 516);
  const latex = await json('latex-validation.json');
  assert.equal(latex.status, 'success'); assert.match(latex.sourceSha256, /^[a-f0-9]{64}$/u);
  for (const path of ['replay-primary.json', 'replay-packaged.json']) {
    const replay = await json(path);
    assert.equal(replay.sourceCommit, '48687898dd26d4e935a0e5ecf6720e7c5aeac15d');
    const source = await readFile(join(repo, 'docs/experiments/light-harness-edit-boundaries-f31-2026-10-16/preparation/fast-glob-source.tar.gz'));
    assert.equal(replay.sourceArchiveSha256, hash(source));
    assert.equal(replay.referenceArchiveSha256, reference.archiveSha256);
    assert.equal(replay.candidateModuleSha256, candidate.files['harness/light-workspace.js']);
    if (path === 'replay-packaged.json') {
      assert.equal(replay.customCandidateOverride, false);
      assert.equal(replay.candidateArchiveSha256, candidate.archiveSha256);
      assert.equal(replay.candidateCommit, candidate.sourceCommit);
    }
    assert.equal(replay.modelRequests, 0); assert.equal(replay.records.length, 36);
    for (const arm of ['reference', 'candidate']) {
      const rows = replay.records.filter(row => row.arm === arm);
      assert.equal(rows.length, 18);
      const inputs = rows.map(row => `${row.repeat}:${JSON.stringify(row.input)}`);
      assert.equal(new Set(inputs).size, 18);
      for (const row of rows) {
        assert.ok(Number.isFinite(row.durationMs) && row.durationMs >= 0);
        assert.equal(row.responseBytes, Buffer.byteLength(JSON.stringify(row.response)));
        assert.equal(row.identityMatches, arm === 'candidate');
        if (arm === 'candidate') {
          const data = row.response.data;
          assert.equal(row.response.status, 'ok'); assert.equal(data.readOnly, true);
          assert.ok(data.content || data.exports?.length);
          assert.ok(Buffer.byteLength(data.content) <= 12000);
          assert.equal(data.alias, undefined); assert.equal(row.response.receipt, undefined);
          assert.equal(data.project.compilerVersion, '5.9.3');
          for (const source of data.sources) {
            assert.equal(source.version, replay.dependencyIdentity[source.package].version);
            assert.equal(source.packageHash, replay.dependencyIdentity[source.package].packageHash);
            assert.match(source.hash, /^[a-f0-9]{64}$/u);
          }
        } else assert.equal(row.response.status, 'blocked');
      }
      const other = replay.records.filter(row => row.arm !== arm).map(row => `${row.repeat}:${JSON.stringify(row.input)}`).sort();
      assert.deepEqual([...inputs].sort(), other);
      assert.deepEqual(replay.arms[arm], { attempts: rows.length, successfulIdentityLookups: rows.filter(row => row.identityMatches).length,
        totalResponseBytes: rows.reduce((sum, row) => sum + row.responseBytes, 0), totalDurationMs: rows.reduce((sum, row) => sum + row.durationMs, 0) });
    }
  }
  const witness = await json('historical-witness.json');
  const ledger = await readFile(join(repo, 'docs/experiments/light-harness-edit-boundaries-f31-2026-10-16/tool-ledger.json'));
  assert.equal(hash(ledger), witness.originalLedgerSha256);
  const original = JSON.parse(ledger);
  for (const row of witness.records) {
    const tool = original.find(trial => trial.name === row.trial).tools[row.zeroBasedToolIndex];
    assert.deepEqual(row.input, tool.input); assert.equal(row.status, tool.output.status); assert.equal(row.message, tool.output.message ?? null);
  }
  return { status: 'ok', inventoryFiles: Object.keys(inventory).length,
    targeted: validation.targetedFinal.passed, registeredPassed: validation.registeredSuite.passed, modelRequests: 0 };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  process.stdout.write(JSON.stringify(await verify(process.argv[2] ? resolve(process.argv[2]) : publication)) + '\n');
