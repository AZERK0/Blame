// Reproduce a known symbol/file boundary diagnostic without a model or solution feedback.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const runtime = resolve(process.argv[2]);
const { lightSemanticHarnessTools } = await import(pathToFileURL(join(runtime, 'dist/harness/light-tools.js')));
const root = await mkdtemp(join(tmpdir(), 'blame-edit-boundary-'));
try {
  const path = join(root, 'value.ts');
  const source = 'export function value() {\n  return 2;\n}\n\n';
  await writeFile(path, source);
  const tools = lightSemanticHarnessTools(root);
  const invoke = (name, input, id) => tools.find(t => t.name === name).execute(input,
    { sessionId: 'boundary-replay', toolCallId: id });
  assert.equal((await invoke('read_code', { target: 'value.ts', view: 'raw' }, 'read')).status, 'ok');
  assert.equal((await invoke('read_code', { target: 'value.ts#value', view: 'symbol' }, 'symbol-read')).status, 'ok');
  const patch = '*** Begin Patch\n*** Update File: value.ts\n@@\n   return 2;\n }\n-\n*** End Patch';
  const symbolPatch = await invoke('edit_code', { operations: [
    { kind: 'patch', target: 's1', patch },
  ] }, 'symbol-patch');
  assert.equal(symbolPatch.status, 'blocked');
  assert.match(symbolPatch.message, /Patch context does not match/);
  assert.equal(await readFile(path, 'utf8'), source);
  const replacement = await invoke('edit_code', { operations: [
    { kind: 'symbol', target: 'value.ts#value', action: 'replace',
      content: 'export function value() {\n  return 2;\n}' },
  ] }, 'symbol-replace');
  assert.equal(replacement.status, 'ok');
  assert.equal(replacement.data.changed, false);
  assert.equal(await readFile(path, 'utf8'), source);
  const filePatch = await invoke('edit_code', { operations: [
    { kind: 'patch', path: 'value.ts', patch },
  ] }, 'file-patch');
  assert.equal(filePatch.status, 'ok');
  assert.equal(filePatch.data.changed, true);
  assert.equal(await readFile(path, 'utf8'), source.slice(0, -1));
  console.log(JSON.stringify({ runtime, externalWhitespaceSymbolPatchBlocked: true,
    symbolReplacementPreservesExternalWhitespace: true, observedFilePatchSucceeds: true,
    scope: 'Direct executor replay; does not simulate SDK mistake limits or model behavior.' }));
} finally {
  await rm(root, { recursive: true, force: true });
}
