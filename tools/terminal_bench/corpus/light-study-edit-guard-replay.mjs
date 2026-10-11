// Deterministic contract replay, independent of model outcomes.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const runtime = resolve(process.argv[2]);
const { lightSemanticHarnessTools } = await import(pathToFileURL(join(runtime, 'dist/harness/light-tools.js')));
const root = await mkdtemp(join(tmpdir(), 'blame-edit-contract-'));
try {
  const path = join(root, 'value.ts');
  const source = 'export function value() { return 1; }\n';
  await writeFile(path, source);
  const tools = lightSemanticHarnessTools(root);
  const invoke = async (name, input, id) => tools.find(t=>t.name===name).execute(input,
    { sessionId: 'grammar-replay', toolCallId: id });
  const invalid = await invoke('edit_code', { operations: [
    {kind:'patch',path:'value.ts',patch:'*** Begin Patch\n*** Update File: value.ts\n@@\n-export function value() { return 1; }\n+export function value() { return 99; }\n*** End Patch'},
    {kind:'replace_body',target:'value.ts#value',content:'return 2;'},
  ] }, 'invalid');
  assert.equal(invalid.status, 'blocked');
  assert.match(invalid.message, /Invalid discriminator/);
  assert.equal(await readFile(path,'utf8'),source);
  assert.equal((await invoke('read_code',{target:'value.ts',view:'outline'},'outline')).status,'ok');
  const unobserved = await invoke('edit_code', {operations:[
    {kind:'symbol',target:'value.ts#value',action:'replace_body',content:'return 2;'},
  ]}, 'unobserved');
  assert.equal(unobserved.status,'blocked');
  assert.match(unobserved.message, /before replacing unobserved source/);
  assert.equal(await readFile(path,'utf8'),source);
  assert.equal((await invoke('read_code',{target:'value.ts#value',view:'symbol'},'read')).status,'ok');
  const accepted = await invoke('edit_code',{operations:[
    {kind:'symbol',target:'value.ts#value',action:'replace_body',content:'return 2;'},
  ]},'accepted');
  assert.equal(accepted.status,'ok');
  assert.match(await readFile(path,'utf8'),/export function value\(\)\s*\{\s*return 2;\s*\}/);
  console.log(JSON.stringify({runtime,invalidBatchAtomic:true,unobservedEditBlocked:true,observedBodyEditSucceeded:true}));
} finally { await rm(root,{recursive:true,force:true}); }
