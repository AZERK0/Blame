// Read-only schema/SDK-source diagnostic. Not a model replay or a timeout change.
import assert from 'node:assert/strict';
import {readFile,readdir,realpath} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {repo,work,study,json,save,sha} from './setup.mjs';
const analysis=await json(join(work,'campaign/analysis.json')),protocol=await json(join(study,'protocol.json'));
assert.equal(analysis.rows.length,protocol.order.length);
const records=[];
for(const row of analysis.rows.filter(r=>r.arm==='cline')){
 const root=join(work,'campaign',row.name),file=(await readdir(root)).find(n=>n.startsWith('schema-')&&n.endsWith('.json'));
 assert.ok(file);const schemas=await json(join(root,file));
 const definition=schemas.find(s=>(s.name??s.function?.name)==='run_commands');assert.ok(definition);
 const parameters=definition.parameters??definition.function.parameters,allowed=Object.keys(parameters.properties);
 assert.deepEqual(allowed,['commands']);assert.equal(parameters.additionalProperties,false);
 const ledger=await json(join(root,'tool-ledger.json')),calls=[];
 for(const[index,t]of ledger.entries())if(t.tool==='run_commands'){
  const extra=Object.fromEntries(Object.entries(t.input??{}).filter(([key])=>!allowed.includes(key)));
  if(Object.keys(extra).length)calls.push({index,extra});
 }
 records.push({name:row.name,hashes:row.hashes,schemaFile:file,allowed,runCommandCalls:ledger.filter(t=>t.tool==='run_commands').length,extraArgumentCalls:calls});
}
const sdk=await realpath(join(repo,'packages/agent-runtime/node_modules/@cline/sdk'));
const bytes=await readFile(join(dirname(sdk),'core/dist/index.js')),source=bytes.toString();
assert.equal(sha(bytes),(await json(join(study,'execution-bindings.json'))).files['@cline/core']['index.js']);
const snippets=['function WZ(', 'function yJ('].map(needle=>{const i=source.indexOf(needle);assert.ok(i>=0);return {needle,text:source.slice(i,i+900)};});
assert.ok(snippets[0].text.includes('Z.commands'));assert.ok(snippets[1].text.includes('Z.bashTimeoutMs??30000')&&snippets[1].text.includes('uC(WZ(B))'));
await save(join(study,'native-argument-observations.json'),{complete:true,modelRequests:0,sourceSha256:sha(bytes),records,sourceSnippets:snippets,
 interpretation:'The advertised run_commands schema exposes commands only and forbids additional properties; completed native calls nevertheless contain timeout/timeout_ms. This pinned SDK extracts commands with WZ and uses factory option bashTimeoutMs (default30000), not those per-call fields. This is a schema/use/feedback mismatch, not evidence of an attributable task failure. No command deadline or result is changed; no runtime control was executed by this read-only diagnostic.'});
console.log(JSON.stringify(records.map(r=>({name:r.name,calls:r.runCommandCalls,extraArgumentCalls:r.extraArgumentCalls.length}))));
