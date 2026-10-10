// Correct a generic build extractor against the unchanged literal instruction.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const directory = resolve(process.argv[2]);
const analysis = JSON.parse(await readFile(join(directory, 'analysis.json'), 'utf8'));
const ledger = JSON.parse(await readFile(join(directory, 'tool-ledger.json'), 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
const rows = [];
for (const row of analysis.rows.filter(row => row.id === 'motion-accessibility')) {
  const instruction = await readFile(join(directory, row.name, 'instruction.txt'));
  assert.match(instruction.toString(), /validation adaptée/u);
  const tools = ledger.find(trial => trial.name === row.name).tools;
  const lastEdit = tools.findLastIndex(tool => tool.tool === 'edit_code'
    ? tool.output?.data?.changed
    : tool.tool === 'apply_patch' && /Successfully applied patch/u.test(JSON.stringify(tool.output)));
  const commands = tools.flatMap((tool, index) => {
    if (tool.tool === 'run_task') {
      const data = tool.output?.data;
      return data?.command ? [{ index, command: data.command, output: data.output ?? '',
        success: tool.output.status === 'ok' && data.exitCode === 0 }] : [];
    }
    return tool.tool === 'run_commands' ? (tool.input.commands ?? []).map((command, i) => ({
      index, command, output: tool.output?.[i]?.result ?? '', success: tool.output?.[i]?.success === true,
    })) : [];
  }).filter(command => command.index > lastEdit && command.success);
  const build = commands.find(command => /\btsc --noEmit\b/u.test(command.command + command.output));
  const read = tools.findIndex((tool, index) => index > lastEdit && tool.tool === 'read_files' &&
    tool.input.files?.some(file => file.path.endsWith('/src/styles.css')));
  const diff = commands.find(command => command.command.includes('git diff --check'));
  const declarations = commands.find(command => /grep/u.test(command.command) &&
    command.command.includes('src/styles.css') &&
    ['.carousel-control:focus-visible', 'prefers-reduced-motion', 'scroll-behavior: auto',
      'transition: none', 'transform: none'].every(value => command.output.includes(value)));
  const sourceInspection = read >= 0 && Boolean(diff && declarations);
  rows.push({ name: row.name, instructionSha256: hash(instruction),
    eventsSha256: row.eventsSha256, lastEditToolIndex: lastEdit,
    posteditBuildPassed: Boolean(build), adaptedValidation: Boolean(build || sourceInspection),
    sourceInspectionRequiresSupervisingReview: sourceInspection,
    evidence: { buildToolIndex: build?.index ?? null, sourceReadToolIndex: read >= 0 ? read : null,
      diffCheckToolIndex: diff?.index ?? null, declarationCheckToolIndex: declarations?.index ?? null },
  });
}
const result = {
  method: 'Extraction correction identified after second-repetition native CSS review: the unchanged instruction asks for adapted validation, not a mandatory build. Apply uniformly to all arms/repetitions. Accept actual post-edit build, or completed source reread plus successful diff/required-declaration inspection after the last edit, subject to supervising source review. Keep original generic build candidates and official scores. No new agent actions, source repair or feedback.',
  rows,
};
await writeFile(join(directory, 'motion-validation-review.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
