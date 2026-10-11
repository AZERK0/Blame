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
  const events = gunzipSync(await readFile(join(directory, 'traces', `${row.name}.events.jsonl.gz`)))
    .toString().trim().split('\n').filter(Boolean).map(line => JSON.parse(line).event);
  const projectInvocations = events.filter(e => e?.type === 'tool' && e.payload.phase === 'finished' &&
    (e.payload.toolCall?.name ?? e.payload.tool) === 'run_task')
    .map(e => ({ input: e.payload.toolCall?.input ?? e.payload.input,
      output: e.payload.output ?? e.payload.result }))
    .filter(t => t.input?.kind === 'project').map(t => {
      const requestedDirectory = [...scopes.values()].includes(t.input.packagePath) ? t.input.packagePath : null;
      const taskId = t.output?.data?.validation?.taskId ?? (requestedDirectory && t.input.task === 'build'
        ? [...scopes].find(([id, cwd]) => cwd === requestedDirectory && (id === 'build' || id.endsWith(':build')))?.[0]
        : null) ?? t.input.task;
      return { taskId, requestedTaskId: t.input.task, packagePath: t.input.packagePath ?? null,
        executionDirectory: t.output?.status !== 'ok' && requestedDirectory
          ? requestedDirectory : scopes.get(taskId) ?? null,
        blocked: t.output?.status === 'blocked' };
    });
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
    blockedFinishAttempts: row.arm === 'cline' ? null : finishOutputs.filter(o => o?.status === 'blocked' || typeof o?.error === 'string').length,
    finishErrors: finishOutputs.filter(o => typeof o?.error === 'string').map(o => o.error),
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
  method: 'Counts all recorded outcomes. Project IDs bind to the fixed fixtures\' declared execution directories; unknown IDs remain null, and invalid file-valued package selectors are not execution directories. Non-root invocation is not intrinsically unnecessary: fresh child/shared cases explicitly require dependent builds. Known unrelated failing packages are fixture facts, not a general dependency classifier. Invocations are not passes or fresh admitted evidence; required-build adjudication is separate. Native commands are preserved for manual inspection, without inventing comparable project counters. Finish refusals include blocked results and SDK error wrappers from full tool outputs; error text remains for causal review. A control on both previously reviewed T2 child failures caught the wrapper distinction before T3 publication. This analysis helper was written during the canary; mechanism endpoints were registered before models.',
  summaries, rows,
}, null, 2) + '\n');
console.log(JSON.stringify(summaries));
