// Reproduce a recorded, atomically rejected request; no model or source repair.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {work,repo,study} from './paths.mjs';
const stage=process.argv[2];assert(['before','after'].includes(stage));
const runtime=stage==='before'?join(work,'frozen/f28/bundle/agent-runtime/dist/harness'):join(repo,'packages/agent-runtime/dist/harness');
const name='1-lodash-own-symbol-options-bundle',sha=b=>createHash('sha256').update(b).digest('hex');
const raw=await readFile(join(work,'f28',name,'events.jsonl'),'utf8');
const calls=raw.trim().split('\n').map(s=>JSON.parse(s).event).filter(e=>e.type==='tool'&&e.payload?.phase==='finished')
 .map(e=>({name:e.payload.toolCall?.name??e.payload.tool,input:e.payload.toolCall?.input??e.payload.input,output:e.payload.output}));
assert.equal(calls[23].name,'edit_code');assert.equal(calls[24].output.status,'blocked');
const root=await mkdtemp(join(work,'duplicate-header-'));
try{
 execFileSync(process.execPath,[join(repo,'tools/terminal_bench/guidance-study/run.mjs'),'prepare','f28',root,'lodash-own-symbol-options'],{cwd:repo,stdio:'pipe'});
 const {LightWorkspace}=await import(join(runtime,'light-workspace.js'));
 const workspace=new LightWorkspace(root,{sessionId:'duplicate-header-diagnostic'});
 for(const call of calls.slice(0,24)){
  assert(['read_code','search_code','edit_code'].includes(call.name));
  const result=call.name==='read_code'?await workspace.readCode(call.input,{}):call.name==='search_code'?await workspace.searchCode(call.input):await workspace.editCode(call.input);
  assert.equal(result.status,call.output.status);
 }
 const before=await readFile(join(root,'lodash.js')),rejected=await workspace.editCode(calls[24].input);
 assert.equal(rejected.status,'blocked');assert.deepEqual(await readFile(join(root,'lodash.js')),before);
 const recovery=JSON.parse(rejected.recovery.slice(rejected.recovery.indexOf('{')));
 assert.deepEqual(recovery.patchCorrection.patchPaths,['lodash.js','lodash.js']);
 assert.equal(recovery.patchCorrection.reason,stage==='before'?'multiple_files_for_symbol':'multiple_headers_for_symbol');
 const result={paidRequests:0,postSelectedDiagnostic:true,stage,trial:name,eventsSha256:sha(raw),recordedPrefixCalls:24,rejectedCall:24,
  runtimePath:resolve(runtime),editModuleSha256:sha(await readFile(join(runtime,'light-edit.js'))),
  sourceBeforeSha256:sha(before),sourceAfterSha256:sha(await readFile(join(root,'lodash.js'))),rejected,
  interpretation:'Recorded duplicate Update File headers address one file. Both versions must reject atomically; the later correction changes only the diagnostic reason. No model benefit or extra successful task is established.'};
 await writeFile(join(study,`duplicate-header-${stage}.json`),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({stage,paidRequests:0,reason:recovery.patchCorrection.reason,sourceUnchanged:true}));
}finally{await rm(root,{recursive:true,force:true});}
