// Recorded-action mechanism audit. It does not certify dependency independence.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

const directory = resolve(process.argv[2]);
const bytes = await readFile(join(directory, 'results.json'));
const results = JSON.parse(bytes);
const ledger = JSON.parse(await readFile(join(directory, 'tool-ledger.json')));
const scopes = new Map([
  ['build', '.'], ['typecheck', '.'],
  ['corpus-web:build', 'apps/web'], ['scope-idle:build', 'apps/idle'],
  ['scope-labels:build', 'packages/labels'],
  ['scope-settings:build', 'packages/settings'],
]);
const required = new Map([
  ['root-backoff', ['build']],
  ['child-label', ['build', 'scope-labels:build']],
  ['shared-batch', ['build', 'scope-settings:build']],
]);
const rows = [];
for (const row of results.rows) {
  const tools = ledger.find(t => t.name === row.name).tools;
  const projectInvocations = tools.filter(t => t.tool === 'run_task' && t.input.kind === 'project')
    .map(t => ({ taskId: t.input.task, packagePath: t.input.packagePath ?? null,
      executionDirectory: scopes.get(t.input.task) ?? null,
      blocked: t.outputExcerpt?.includes('"status":"blocked"') ?? false }));
  const events = gunzipSync(await readFile(join(directory, 'traces', `${row.name}.events.jsonl.gz`)))
    .toString().trim().split('\n').filter(Boolean).map(line => JSON.parse(line).event);
  const finishOutputs = events.filter(e => e?.type === 'tool' && e.payload.phase === 'finished' &&
    (e.payload.toolCall?.name ?? e.payload.tool) === 'finish_task')
    .map(e => e.payload.output ?? e.payload.result);
  const declared = required.get(row.id) ?? null;
  rows.push({ name: row.name, id: row.id, repetition: row.repetition, arm: row.arm,
    auditedCompletion: row.auditedSuccess && row.status === 'succeeded',
    projectInvocations, taskSelectionRefusals: row.taskSelectionRefusals,
    nonRootProjectInvocations: row.arm === 'cline' ? null : projectInvocations.filter(t => t.executionDirectory && t.executionDirectory !== '.').length,
    knownUnrelatedFailingPackageInvocations: row.arm === 'cline' ? null : projectInvocations.filter(t => ['corpus-web:build', 'scope-idle:build'].includes(t.taskId)).length,
    declaredRequiredTaskIds: declared,
    declaredTaskIdsInvoked: declared && projectInvocations.filter(t => declared.includes(t.taskId)).map(t => t.taskId),
    finishAttempts: row.arm === 'cline' ? null : finishOutputs.length,
    blockedFinishAttempts: row.arm === 'cline' ? null : finishOutputs.filter(o => o?.status === 'blocked').length,
    // Retain actual native commands; unused JSON fields are not executed evidence.
    nativeCommands: row.arm === 'cline' ? tools.filter(t => t.tool === 'run_commands').map(t => t.input.commands) : null,
  });
}
const summaries = Object.fromEntries(['baseline', 'modified', 'cline'].map(arm => {
  const selected = rows.filter(r => r.arm === arm);
  const sum = key => arm === 'cline' ? null : selected.reduce((n, r) => n + r[key], 0);
  return [arm, { trials: selected.length, auditedCompletion: selected.filter(r => r.auditedCompletion).length,
    projectInvocations: arm === 'cline' ? null : selected.reduce((n, r) => n + r.projectInvocations.length, 0),
    nonRootProjectInvocations: sum('nonRootProjectInvocations'),
    knownUnrelatedFailingPackageInvocations: sum('knownUnrelatedFailingPackageInvocations'),
    taskSelectionRefusals: selected.reduce((n, r) => n + r.taskSelectionRefusals, 0),
    finishAttempts: sum('finishAttempts'), blockedFinishAttempts: sum('blockedFinishAttempts') }];
}));
await writeFile(join(directory, 'task-scope-mechanism.json'), JSON.stringify({
  sourceResultsSha256: createHash('sha256').update(bytes).digest('hex'),
  method: 'Counts all recorded outcomes. Project IDs bind to the fixed fixtures\' declared execution directories; unknown IDs remain null. Non-root invocation is not intrinsically unnecessary: fresh child/shared cases explicitly require dependent builds. Known unrelated failing packages are fixture facts, not a general dependency classifier. Invocations are not passes or fresh admitted evidence; required-build adjudication is separate. Native commands are preserved for manual inspection, without inventing comparable project counters. Finish refusals come from full tool outputs. This analysis helper was written during the canary; mechanism endpoints were registered before models.',
  summaries, rows,
}, null, 2) + '\n');
console.log(JSON.stringify(summaries));
