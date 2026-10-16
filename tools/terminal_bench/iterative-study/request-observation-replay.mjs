import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repo, study, json, save, sha } from './setup.mjs';
const referenceArchive = await readFile(join(study, 'baseline-benchmark-metrics.js.gz'));
const referenceManifest = await json(join(study, 'baseline-benchmark-metrics.json'));
assert.equal(sha(referenceArchive), referenceManifest.archiveSha256);
const root = await mkdtemp(join(tmpdir(), 'f40-counter-'));
try {
  const reference = gunzipSync(referenceArchive); assert.equal(sha(reference), referenceManifest.compiledModuleSha256);
  await writeFile(join(root, 'reference.mjs'), reference);
  const oldModule = await import(pathToFileURL(join(root, 'reference.mjs')).href);
  const newModule = await import(pathToFileURL(join(repo, 'packages/benchmark-runner/dist/benchmark-metrics.js')).href);
  const rows = [];
  for (const name of ['1-yaml-anchor-ranges-candidate', '1-yaml-anchor-ranges-cline', '2-yaml-anchor-ranges-cline', '3-yaml-anchor-ranges-cline']) {
    const bytes = await readFile(join(repo, 'docs/experiments/light-harness-request-limits-model-f36-2026-10-16/traces', name + '.json.gz'));
    const trace = JSON.parse(gunzipSync(bytes));
    const file = path => {
      const bytes = Buffer.from(trace.files[path].base64, 'base64');
      assert.equal(sha(bytes), trace.files[path].sha256); return bytes.toString();
    };
    const events = file('events.jsonl').trim().split('\n').map(JSON.parse).map(row => row.event);
    const wire = file('wire-contracts.jsonl').trim().split('\n').filter(Boolean).map(JSON.parse);
    const original = JSON.parse(file('result.json'));
    const collectors = [new oldModule.BenchmarkMetricsCollector(), new newModule.BenchmarkMetricsCollector()];
    events.forEach((event, index) => collectors.forEach(collector => collector.record(event, index)));
    const [before, after] = collectors.map(collector => collector.summary(new Date(0), new Date(events.length)));
    assert.equal(before.context.modelRequests, original.metrics.context.modelRequests);
    const reports = events.filter(event => event.type === 'usage');
    const inputs = reports.filter(event => typeof event.payload?.usage?.inputTokens === 'number' && Number.isFinite(event.payload.usage.inputTokens) && event.payload.usage.inputTokens >= 0);
    const starts = events.filter(event => event.type === 'notice' && event.payload?.message === 'Agent iteration started.');
    assert.deepEqual(after.context.requestObservations, { schemaVersion: 'request-observations-v1', coverage: 'agent_events_only',
      iterationStartEvents: starts.length, usageReportEvents: reports.length, inputTokenReportEvents: inputs.length,
      transportAttempts: null, completedResponses: null });
    assert.equal(after.context.modelRequests, null);
    const strip = metrics => {
      const copy = structuredClone(metrics);
      for (const key of ['modelRequests', 'requestObservations', 'averageInputTokens', 'maximumInputTokens']) delete copy.context[key];
      return copy;
    };
    assert.deepEqual(strip(before), strip(after), 'Other metrics must remain unchanged');
    rows.push({ name, originalTraceSha256: sha(bytes), legacyRecordedModelRequests: original.metrics.context.modelRequests,
      referenceRecomputedModelRequests: before.context.modelRequests, correctedContext: after.context,
      independentWireForwardingAttempts: wire.filter(row => !row.budgetRejected).length,
      originalUsage: original.usage, otherMetricsUnchanged: true });
  }
  await save(join(study, 'cycle3-recorded-replay.json'), { modelRequests: 0,
    clock: 'Same logical event index for both collectors; this is not an original wall-duration replay.',
    method: 'Original events and wire sideband remain separate. Collector returns unknown transport; wire observations do not prove billing or hidden retries. No historical result or cost is rewritten.', rows });
  console.log(JSON.stringify(rows.map(row => ({ name: row.name, old: row.legacyRecordedModelRequests,
    modelRequests: row.correctedContext.modelRequests, observations: row.correctedContext.requestObservations,
    wire: row.independentWireForwardingAttempts, otherMetricsUnchanged: row.otherMetricsUnchanged }))));
} finally { await rm(root, { recursive: true, force: true }); }
