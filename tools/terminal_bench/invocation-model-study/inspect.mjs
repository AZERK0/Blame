import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { work } from './paths.mjs';
const [name, mode = 'inputs'] = process.argv.slice(2);
if (!/^[1-3]-yaml-anchor-ranges-(?:baseline|candidate|cline)$/u.test(name)) throw Error('Unknown registered trial');
const directory = join(work, 'f34', name);
if (mode === 'diff') console.log(await readFile(join(directory, 'workspace.diff'), 'utf8'));
else {
  const events = (await readFile(join(directory, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  const tools = events.filter(e => e.event?.type === 'tool').map(e => ({ ...e.event.payload,
    tool: e.event.payload.toolCall?.name ?? e.event.payload.tool,
    input: e.event.payload.toolCall?.input ?? e.event.payload.input })).filter(t => t.phase === 'finished');
  if (mode === 'inputs') for (const [index, t] of tools.entries()) console.log(JSON.stringify({ index, tool: t.tool, input: t.input, status: t.output?.status }));
  else if (mode === 'checks') for (const [index, t] of tools.entries()) {
    if (!['run_task', 'run_commands', 'finish_task'].includes(t.tool)) continue;
    const d = t.output?.data?.completed?.data ?? t.output?.data;
    console.log(JSON.stringify({ index, tool: t.tool, input: t.input, output: t.tool === 'run_commands' || t.tool === 'finish_task' ? t.output :
      { status: t.output?.status, command: d?.command, exitCode: d?.exitCode, validation: d?.validation, check: d?.check, reporting: d?.reporting, output: d?.output } }));
  }
  else if (mode === 'delivery') console.log(JSON.stringify(events.filter(e => e.event?.type !== 'tool' && /(?:3483|3,483|anchorRange|tests|completed)/u.test(JSON.stringify(e.event))).slice(-8)));
  else throw Error('Mode must be inputs, diff, checks or delivery');
}
