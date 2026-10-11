// Read complete recorded tool outputs; excerpts can omit diagnostic details.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

const directory = resolve(process.argv[2]);
const resultsBytes = await readFile(join(directory, 'results.json'));
const results = JSON.parse(resultsBytes);
const sha = value => createHash('sha256').update(value).digest('hex');
const rows = [];
for (const trial of results.rows) {
  const bytes = gunzipSync(await readFile(join(directory, 'traces', `${trial.name}.events.jsonl.gz`)));
  const events = bytes.toString().split('\n').filter(Boolean).map(line => JSON.parse(line).event);
  const blocked = [];
  let edits = 0, symbolicOperations = 0, patchOperations = 0;
  for (const event of events) {
    if (event?.type !== 'tool' || event.payload.phase !== 'finished') continue;
    const payload = event.payload;
    if ((payload.toolCall?.name ?? payload.tool) !== 'edit_code') continue;
    edits++;
    const input = payload.toolCall?.input ?? payload.input;
    for (const op of input?.operations ?? []) {
      symbolicOperations += Number(op.kind === 'symbol');
      patchOperations += Number(op.kind === 'patch');
    }
    const output = payload.output ?? payload.result;
    if (output?.status !== 'blocked') continue;
    const message = output.message ?? '';
    const reason = message.includes('Invalid discriminator') ? 'invalid-discriminator'
      : message.includes('unobserved source') ? 'unobserved-source'
      : message.includes('observed symbol alias') ? 'scoped-patch-alias'
      : message.includes('Patch context') ? 'patch-context'
      : output.category === 'code' ? 'source-validation' : 'other';
    blocked.push({ toolCallId: payload.toolCall?.id ?? payload.toolCallId,
      category: output.category, reason, message, inputSha256: sha(JSON.stringify(input)),
      operations: (input?.operations ?? []).map(({kind, target, action}) => ({kind, target, action})) });
  }
  rows.push({ name: trial.name, arm: trial.arm, auditedCompletion: trial.auditedCompletion,
    eventsSha256: sha(bytes), edits, symbolicOperations, patchOperations, blocked });
}
const summaries = {};
for (const arm of ['baseline', 'modified', 'cline']) {
  const trials = rows.filter(row => row.arm === arm);
  const blocks = trials.flatMap(row => row.blocked);
  summaries[arm] = { trials: trials.length, editCalls: trials.reduce((n,r)=>n+r.edits,0),
    symbolicOperations: trials.reduce((n,r)=>n+r.symbolicOperations,0),
    patchOperations: trials.reduce((n,r)=>n+r.patchOperations,0),
    invalidDiscriminatorTrials: trials.filter(r=>r.blocked.some(b=>b.reason==='invalid-discriminator')).length,
    blockedByReason: Object.fromEntries([...new Set(blocks.map(b=>b.reason))].map(reason=>[reason,blocks.filter(b=>b.reason===reason).length])) };
}
const report = { sourceResultsSha256: sha(resultsBytes),
  method: 'Complete finished edit_code outputs from every retained trial. Invalid discriminator attempts, all block reasons, operation choices and affected trials describe the T2 mechanism. Native has a different editing API; zero edit_code calls are not zero native editing friction. Counts are not billed tokens or task-quality evidence.',
  summaries, rows };
await writeFile(join(directory, 'edit-mechanism.json'), JSON.stringify(report, null, 2)+'\n');
console.log(JSON.stringify(summaries));
