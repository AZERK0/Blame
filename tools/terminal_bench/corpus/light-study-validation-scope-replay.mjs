// Post-outcome diagnostic: reproduce completion's treatment of unrelated task failures.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const runtime = resolve(process.argv[2]);
const { lightSemanticHarnessTools } = await import(pathToFileURL(join(runtime, 'dist/harness/light-tools.js')));
const { executeLocalFinishTask } = await import(pathToFileURL(join(runtime, 'dist/harness/light-finish-service.js')));
async function replay(rootExit, includeChild) {
  const root = await mkdtemp(join(tmpdir(), 'blame-validation-scope-'));
  try {
    await mkdir(join(root, 'apps/web'), { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'scope-root', scripts: {
      build: `node -e "process.exit(${rootExit})"`,
    } }));
    await writeFile(join(root, 'apps/web/package.json'), JSON.stringify({ name: 'scope-child', scripts: {
      build: 'node -e "process.exit(9)"',
    } }));
    await writeFile(join(root, 'value.ts'), 'export const value = 1;\n');
    const tools = lightSemanticHarnessTools(root);
    const invoke = (name, input, id) => tools.find(t => t.name === name).execute(input,
      { sessionId: 'scope-replay', toolCallId: id });
    assert.equal((await invoke('read_code', { target: 'value.ts', view: 'raw' }, 'read')).status, 'ok');
    assert.equal((await invoke('edit_code', { operations: [{ kind: 'patch', path: 'value.ts',
      patch: '*** Begin Patch\n*** Update File: value.ts\n@@\n-export const value = 1;\n+export const value = 2;\n*** End Patch',
    }] }, 'edit')).status, 'ok');
    const build = await invoke('run_task', { kind: 'project', task: 'build' }, 'root-build');
    assert.equal(build.status, rootExit === 0 ? 'ok' : 'blocked');
    let child;
    if (includeChild) {
      child = await invoke('run_task', { kind: 'project', task: 'scope-child:build' }, 'child-build');
      assert.equal(child.status, 'blocked');
      assert.match(child.message, /code 9/);
    }
    const finish = await executeLocalFinishTask({ workspaceRoot: root,
      input: { summary: 'Toy scope replay; process exit tests only.' },
      context: { sessionId: 'scope-replay', toolCallId: 'finish' } });
    assert.equal(finish.status, rootExit === 0 && !includeChild ? 'ok' : 'blocked');
    if (includeChild) assert.match(finish.message, /scope-child:build/);
    assert.equal(await readFile(join(root, 'value.ts'), 'utf8'), 'export const value = 2;\n');
    return { rootExit, includeChild, finishStatus: finish.status,
      ...(finish.status === 'blocked' ? { message: finish.message } : {}) };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const controls = [];
for (const [exit, child] of [[0, false], [0, true], [9, false]]) controls.push(await replay(exit, child));
console.log(JSON.stringify({ runtime, controls,
  classification: 'Post-outcome direct-executor diagnostic, not model confirmation or task-quality evidence. Toy builds check process exit only. No scope-policy change or task-agent feedback.' }));
