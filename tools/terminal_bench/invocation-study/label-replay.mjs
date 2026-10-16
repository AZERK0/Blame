import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { taskInvocationDisplay } from '../../../packages/agent-runtime/dist/harness/task-catalog.js';
const study = fileURLToPath(new URL('../../../docs/experiments/light-harness-invocation-f33-2026-10-16/', import.meta.url));
const audit = JSON.parse(await readFile(study + 'corrected-f31-audit.json'));
const rows = audit.reconstructedProjectInvocations.map(r => {
  const before = r.originalReturnedCommand, after = taskInvocationDisplay(r.reconstructedInvocation);
  return { name: r.name, toolIndexZeroBased: r.toolIndexZeroBased, before, after,
    beforeBytes: Buffer.byteLength(before), afterBytes: Buffer.byteLength(after) };
});
const before = rows.reduce((n, r) => n + r.beforeBytes, 0), after = rows.reduce((n, r) => n + r.afterBytes, 0);
const result = { paidRequests: 0,
  method: 'Known-input replay of recorded successful non-instrumented F31 project task labels. Same reconstructed npm executable/argv. Measures command field bytes only, not complete tool output, billed/model tokens or task quality.',
  rows, beforeBytes: before, afterBytes: after, relativeChange: after / before - 1,
  shorter: rows.filter(r => r.afterBytes < r.beforeBytes).length,
  longer: rows.filter(r => r.afterBytes > r.beforeBytes).length,
  equal: rows.filter(r => r.afterBytes === r.beforeBytes).length };
if (process.argv.includes('--verify')) assert.deepEqual(JSON.parse(await readFile(study + 'recorded-label-replay.json')), result);
else await writeFile(study + 'recorded-label-replay.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, rows: rows.length }));
