import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {repo,work,study} from './paths.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const rows=[],contracts=[];
for(const arm of ['baseline','candidate']){
 const runtime=join(work,'frozen/f31',arm,'agent-runtime/dist/harness'),{lightSemanticHarnessTools}=await import(join(runtime,'light-tools.js')),{createLightCompletionTool}=await import(join(runtime,'light-completion.js'));
 contracts.push({arm,tools:[...lightSemanticHarnessTools('/tmp/f31-contract',{executor:async()=>({status:'ok',data:{}}),taskContract:{environment:{managedPreview:false}}}),createLightCompletionTool(async summary=>({summary}))].map(t=>({name:t.name,description:t.description,inputSchema:JSON.parse(JSON.stringify(t.inputSchema)),lifecycle:t.lifecycle??null,retryable:t.retryable,maxRetries:t.maxRetries}))});
 for(const panel of ['existing-guidance','indent-regression']){
  const tests=panel==='existing-guidance'?['light-agent-navigation-guidance.test','light-agent-editing-guidance.test','light-agent-validation-guidance.test']:['light-whole-symbol-indent.test'];
  const argv=[process.execPath,'--test',...tests.map(t=>join(repo,'packages/agent-runtime/dist/harness',t+'.js'))];
  const r=spawnSync(argv[0],argv.slice(1),{cwd:repo,env:{...process.env,BLAME_GUIDANCE_RUNTIME:runtime},encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});
  const expected=arm==='baseline'&&panel==='indent-regression'?1:0;assert.equal(r.status,expected,r.stderr+r.stdout);
  assert.match(r.stdout,panel==='existing-guidance'?/tests 21\b/u:/tests 6\b/u);
  if(expected)assert.match(r.stdout,/fail 3\b/u);
  rows.push({arm,panel,argv,exitCode:r.status,expectedExitCode:expected,stdout:r.stdout,stderr:r.stderr});
 }
}
assert.deepEqual(contracts[0].tools,contracts[1].tools);
const parent=join(repo,'docs/experiments/light-harness-concise-f30-2026-10-15');
const trace=gunzipSync(await readFile(join(parent,'traces/2-commander-canonical-choices-candidate.events.jsonl.gz'))),events=trace.toString().trim().split('\n').map(l=>JSON.parse(l).event);
const batches=events.filter(e=>e.type==='tool'&&e.payload.phase==='started'&&e.payload.toolCall.name==='edit_code').map(e=>e.payload.toolCall.input.operations.filter(op=>op.kind==='symbol'));
assert.equal(batches.length,3);
const targets={s80:'lib/argument.js#Argument.choices',s31:'lib/option.js#Option.choices'},replays=[];
for(const arm of ['baseline','candidate']){
 const temporary=await mkdtemp(join(work,'known-indent-replay-'));
 try{
  const r=spawnSync('tar',['-xzf',join(parent,'preparation/upstream-source.tar.gz'),'-C',temporary]);assert.equal(r.status,0);
  const {LightWorkspace}=await import(join(work,'frozen/f31',arm,'agent-runtime/dist/harness/light-workspace.js')),workspace=new LightWorkspace(temporary,{sessionId:'f31-known-indent'}),steps=[];
  for(const [index,batch]of batches.entries()){
   for(const op of batch)await workspace.readCode({target:targets[op.target]},{});
   const result=await workspace.editCode({operations:batch.map(op=>({...op,target:targets[op.target]}))});assert.equal(result.status,'ok',JSON.stringify(result));
   const files={};for(const path of ['lib/argument.js','lib/option.js']){const content=await readFile(join(temporary,path),'utf8');files[path]={sha256:sha(content),firstLineIndent:content.match(/\n([\t ]*)choices\(values/u)[1].length};}
   steps.push({index,parse:result.data.parse,files});
  }
  const stable=JSON.stringify(steps[1].files)===JSON.stringify(steps[2].files);assert.equal(stable,arm==='candidate');
  replays.push({arm,steps,repeatedWholeReplacementStable:stable});
 }finally{await rm(temporary,{recursive:true,force:true});}
}
await writeFile(join(study,'runtime-controls.json'),JSON.stringify({paidRequests:0,method:'Identical full tool contracts; existing21 guidance tests per runtime; six new byte-exact regression/safety cases with three expected baseline failures. Targeted replay of original F30 symbol batches,remapping aliases to qualified names and rereading before writes. The unrelated type patch and commands are omitted; this is not a complete original-session replay or a new task success.',rows,contracts,knownInputReplay:{traceSha256:sha(trace),replays}},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({paidRequests:0,unchangedContracts:true,knownReplayStable:replays.map(r=>({arm:r.arm,stable:r.repeatedWholeReplacementStable}))}));
