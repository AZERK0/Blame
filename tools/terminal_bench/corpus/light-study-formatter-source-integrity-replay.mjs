// Exploratory source-integrity diagnosis for a format whose parser is unsupported.
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const rows = [];
for (const requested of process.argv.slice(2)) {
  const runtime = resolve(requested);
  const { LightWorkspace } = await import(pathToFileURL(join(runtime, 'dist/harness/light-workspace.js')));
  const { SessionJournal } = await import(pathToFileURL(join(runtime, 'dist/harness/session-journal.js')));
  const root = await mkdtemp(join(tmpdir(), 'blame-formatter-markdown-'));
  try {
    await mkdir(join(root, 'node_modules/.bin'), { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify({ devDependencies: { prettier: '3.0.0' } }));
    const executable = ['#!/usr/bin/env node', 'let source="";', 'process.stdin.setEncoding("utf8");',
      'process.stdin.on("data",chunk=>source+=chunk);',
      'process.stdin.on("end",()=>process.stdout.write(source.trimEnd()+"\\n"));'].join('\n');
    await writeFile(join(root, 'node_modules/.bin/prettier'), executable);
    await chmod(join(root, 'node_modules/.bin/prettier'), 0o755);
    const before = '# Note\n\nA paragraph';
    const expected = before + '\n';
    await writeFile(join(root, 'NOTE.md'), before);
    const workspace = new LightWorkspace(root, { sessionId: 'formatter-markdown', taskContract: {
      session_id: 'formatter-markdown', objective: 'format NOTE.md', acceptance_criteria: ['formatted Markdown only'], effect_requirement: 'source_change',
    } });
    const result = await workspace.tasks.run({ kind: 'command', command: 'pnpm exec prettier --write NOTE.md' });
    const actual = await readFile(join(root, 'NOTE.md'), 'utf8');
    const journal = await new SessionJournal(root, 'formatter-markdown').completionSnapshot();
    if (result.status === 'blocked') assert.equal(actual, before);
    rows.push({ runtime, result, sourceMatchesRequestedFormatting: actual === expected, sourceChanged: actual !== before,
      expected, actual, changedPaths: journal.changedPaths, validations: journal.validations,
      completionNotInvoked: true });
  } finally { await rm(root, { recursive: true, force: true }); }
}
assert.ok(rows.length, 'Pass at least one built runtime directory.');
console.log(JSON.stringify({ classification: 'Exploratory environment-dependent direct executor replay. Exit success, syntax support, admitted formatter validation, requested source correctness and task completion are distinct. No model or solution feedback. Temporary isolated fixture declares Prettier 3.0.0.', rows }, null, 2));
