// Post-outcome diagnosis of a preexisting formatter test; never used as model feedback.
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const results = [];
for (const requested of process.argv.slice(2)) {
  const runtime = resolve(requested);
  const load = name => import(pathToFileURL(join(runtime, 'dist/harness', name + '.js')));
  const { DeterministicFormatter } = await load('deterministic-formatter');
  const { WorkspaceFiles } = await load('workspace-files');
  const { LightWorkspace } = await load('light-workspace');
  const root = await mkdtemp(join(tmpdir(), 'blame-formatter-output-'));
  try {
    const executable = [
      '#!/usr/bin/env node', 'let source = "";',
      'process.stdin.setEncoding("utf8");',
      'process.stdin.on("data", chunk => { source += chunk; });',
      'process.stdin.on("end", () => {',
      '  if (source.includes("INVALID")) process.exit(2);',
      '  process.stdout.write(source.replace(/const (\\w+)=\\{value:(\\d+)\\}/gu, "const $1 = { value: $2 };"));',
      '});',
    ].join('\n');
    const before = 'export const first={value:1}\n';
    const expected = 'export const first = { value: 1 };\n';
    for (const directory of ['direct', 'guarded']) {
      const fixture = join(root, directory);
      await mkdir(join(fixture, 'node_modules/.bin'), { recursive: true });
      await writeFile(join(fixture, 'package.json'), JSON.stringify({ devDependencies: { prettier: '3.0.0' } }));
      await writeFile(join(fixture, 'node_modules/.bin/prettier'), executable);
      await chmod(join(fixture, 'node_modules/.bin/prettier'), 0o755);
      await writeFile(join(fixture, 'first.ts'), before);
    }
    const guarded = join(root, 'guarded');
    const workspace = new LightWorkspace(guarded, {
      sessionId: 'formatter-output-replay',
      taskContract: { session_id: 'formatter-output-replay', objective: 'format the requested file',
        acceptance_criteria: ['format first.ts'], effect_requirement: 'source_change' },
    });
    const result = await workspace.tasks.run({ kind: 'command', command: 'pnpm exec prettier --write first.ts' });
    const sourceAfter = await readFile(join(guarded, 'first.ts'), 'utf8');
    // Separate direct formatter observation from the guarded task execution.
    const direct = join(root, 'direct');
    const formatter = new DeterministicFormatter(new WorkspaceFiles(direct));
    const replacements = await formatter.format(formatter.request('pnpm exec prettier --write first.ts'), direct);
    const actual = replacements[0].content;
    if (result.status === 'blocked') assert.equal(sourceAfter, before);
    else { assert.equal(result.status, 'ok'); assert.equal(sourceAfter, expected); }
    results.push({ runtime, result, sourceUnchangedWhenBlocked: result.status === 'blocked' && sourceAfter === before,
      expected, actual, exactFormatterOutput: actual === expected, launcherOutputBeforeSource: actual.endsWith(expected) && actual !== expected });
  } finally { await rm(root, { recursive: true, force: true }); }
}
assert.ok(results.length, 'Pass at least one built runtime directory.');
console.log(JSON.stringify({ classification: 'Exploratory environment-dependent direct replay. Not a model task or T3 comparison. Temporary pnpm launcher may install the declared formatter in the isolated fixture; frozen runtime dependencies are unchanged.', results }, null, 2));
