// Backward compatibility and explicit rejection of unsupported new metrics.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repo, study, save } from './setup.mjs';
const root = await mkdtemp(join(tmpdir(), 'light-legacy-metrics-'));
const controls = [];
try {
  const rows = ['modified', 'cline'].map(arm => ({ name: arm, arm, id: 'compatibility', repetition: 1,
    condition: 'ordinary', auditedSuccess: true, status: 'succeeded', usage: { input: 12, output: 3 } }));
  await mkdir(join(root, 'traces'));
  await save(join(root, 'results.json'), { rows });
  await save(join(root, 'tool-ledger.json'), rows.map(row => ({ name: row.name, tools: [] })));
  for (const modern of [false, true]) {
    for (const row of rows) {
      const context = { modelRequests: modern ? null : 2, composition: { composedBytes: 100, messageBytes: 60, categoryBytes: {} } };
      if (modern) context.requestObservations = { schemaVersion: 'request-observations-v1', transportAttempts: null };
      await writeFile(join(root, 'traces', row.name + '.result.json.gz'), gzipSync(JSON.stringify({ metrics: { context, tools: { calls: 0 } } })));
      await writeFile(join(root, 'traces', row.name + '.events.jsonl.gz'), gzipSync(JSON.stringify({ event: { type: 'done' } }) + '\n'));
    }
    for (const name of ['diagnosis', 'mechanism']) {
      const run = spawnSync(process.execPath, [join(repo, `tools/terminal_bench/corpus/light-study-skill-${name}.mjs`), root, join(root, 'diagnosis.json')], { encoding: 'utf8' });
      if (modern) { assert.notEqual(run.status, 0); assert.match(run.stderr, /do not coerce unknown requests to zero/u); }
      else assert.equal(run.status, 0, run.stderr);
      controls.push({ reporter: name, metrics: modern ? 'request-observations-v1' : 'historical', exitCode: run.status,
        expectedBehavior: modern ? 'Explicitly rejects unsupported transport semantics' : 'Historical report still runs', passed: true });
    }
  }
  await save(join(study, 'legacy-report-controls.json'), { modelRequests: 0, controls });
  console.log(JSON.stringify({ controls: controls.length, passed: true }));
} finally { await rm(root, { recursive: true, force: true }); }
