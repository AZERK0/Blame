// Supplement manual source review with exact post-edit invocation witnesses.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { work as defaultWork, study as defaultStudy, json, save } from './setup.mjs';
const work = process.argv[2] ? resolve(process.argv[2]) : defaultWork;
const study = process.argv[3] ? resolve(process.argv[3]) : defaultStudy;
const rows = (await json(join(work, 'campaign/analysis.json'))).rows;
const records = [];
for (const row of rows) {
  const tools = await json(join(work, 'campaign', row.name, 'tool-ledger.json'));
  const lastEdit = tools.findLastIndex(tool => tool.tool === 'edit_code' && tool.output?.status === 'ok' || tool.tool === 'apply_patch' && tool.output?.success === true);
  const commands = [];
  for (const [index, tool] of tools.entries()) {
    if (tool.tool === 'run_task') {
      const command = tool.output?.data?.command;
      if (command) commands.push({ index, command, numericExitCode: tool.output.data.exitCode ?? null,
        processSuccess: tool.output.data.exitCode === 0, checkOutcome: tool.output.data.check?.outcome ?? null });
    } else if (tool.tool === 'run_commands') {
      for (const output of Array.isArray(tool.output) ? tool.output : [])
        commands.push({ index, command: output.query, numericExitCode: null, processSuccess: output.success === true,
          evidence: 'Frozen SDK single literal command result.success is exit-status based; raw numeric exit code is absent.' });
    }
  }
  const required = {};
  for (const name of ['regression', 'feature', 'types']) {
    const expected = `npm run test:study:${name}`;
    required[name] = commands.filter(command => command.command === expected && command.index > lastEdit && command.processSuccess);
    assert.ok(required[name].length > 0, `${row.name}: missing post-edit ${name} invocation`);
  }
  const raw = (await readFile(join(work, 'campaign', row.name, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  const delivery = raw.map(row => row.event).findLast(event => event.type === 'done')?.payload?.text ??
    tools.findLast(tool => tool.tool === 'finish_task')?.input?.summary ?? null;
  assert.ok(typeof delivery === 'string' && delivery.length > 100);
  records.push({ name: row.name, hashes: row.hashes, lastSuccessfulEditIndex: lastEdit, required,
    allRequestedFinalSourceInvocationsSucceeded: true, delivery,
    note: 'This witnesses commands/process results only; manual review separately judges source, factual delivery, protected writes and solution retrieval.' });
}
await save(join(study, 'invocation-witnesses.json'), { records });
console.log(JSON.stringify({ witnessed: records.length, allRequiredScriptsAfterFinalEdit: true }));
