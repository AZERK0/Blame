import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const directory = resolve(process.argv[2]);
const analysis = JSON.parse(await readFile(join(directory, 'analysis.json'), 'utf8'));
const ledger = JSON.parse(await readFile(join(directory, 'tool-ledger.json'), 'utf8'));
const rows = [];
for (const row of analysis.rows.filter(row => row.recoveryNotices > 0)) {
  const raw = await readFile(join(directory, row.name, 'events.jsonl'));
  const records = raw.toString().trim().split('\n').map(line => JSON.parse(line));
  const recoveries = records.filter(({ event }) => event?.type === 'notice' &&
    /resuming from the persisted session state/u.test(event.payload?.message ?? ''));
  assert.equal(recoveries.length, row.recoveryNotices);
  const tools = ledger.find(trial => trial.name === row.name).tools;
  const first = records.indexOf(recoveries[0]);
  const completedBefore = records.slice(0, first).filter(({ event }) =>
    event?.type === 'tool' && event.payload.phase === 'finished');
  const after = records.slice(first + 1);
  const lastDone = records.findLast(({ event }) => event?.type === 'done')?.event;
  rows.push({
    name: row.name, condition: row.condition, status: row.status,
    eventsSha256: createHash('sha256').update(raw).digest('hex'),
    recoveryNoticeTimes: recoveries.map(record => record.recordedAt),
    completedToolsBeforeFirstRecovery: completedBefore.map(({ event }) => ({
      tool: event.payload.toolCall?.name ?? event.payload.tool,
      id: event.payload.toolCall?.id ?? event.payload.toolCallId,
    })),
    completedToolsAfterFirstRecovery: after.filter(({ event }) =>
      event?.type === 'tool' && event.payload.phase === 'finished').map(({ event }) => ({
        tool: event.payload.toolCall?.name ?? event.payload.tool,
        id: event.payload.toolCall?.id ?? event.payload.toolCallId,
      })),
    successfulEdits: tools.filter(tool => tool.tool === 'edit_code' && tool.output?.data?.changed).length,
    logicalStartedIterations: records.filter(({ event }) => event?.type === 'notice' &&
      event.payload.message === 'Agent iteration started.').map(({ event }) => event.payload.iteration),
    requests: row.usage.requests, usageReports: row.usage.reports,
    tokensCostReconciled: row.usage.tokensCostReconciled,
    observedUsage: { input: row.usage.input, output: row.usage.output, sdkCost: row.usage.cost },
    lastSdkDoneUsage: lastDone?.payload?.usage ?? null,
    verification: lastDone?.payload?.completion?.verification ?? null,
  });
}
const result = { inspectedAt: new Date().toISOString(), completed: analysis.completed,
  planned: analysis.planned,
  method: 'Recorded recovery notices and complete tool events, without source repair or task-agent feedback. H3 is shared by both Light arms; natural activation does not identify a T1 effect. No HTTP wire observation or invoice reconciliation; a recognized interruption does not identify its underlying provider/SDK cause.',
  rows };
await writeFile(join(directory, 'recovery-inspection.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ inspected: rows.length, rows }));
