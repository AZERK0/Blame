import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {repo,study,work} from './paths.mjs';
const require=createRequire(join(repo,'packages/agent-runtime/package.json')),ts=require('typescript');
function eraseDescriptions(text){const source=ts.createSourceFile('module.js',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),spans=[];function visit(node){if(ts.isPropertyAssignment(node)&&node.name.getText(source)==='description')spans.push([node.initializer.getStart(source),node.initializer.end]);else ts.forEachChild(node,visit);}visit(source);for(const [a,b]of spans.sort((a,b)=>b[0]-a[0]))text=text.slice(0,a)+'"<description>"'+text.slice(b);return text;}
for(const name of ['light-tools','light-completion']){
 const source=arm=>readFile(join(work,'frozen/f30',arm,'agent-runtime/dist/harness',name+'.js'),'utf8');assert.equal(eraseDescriptions(await source('baseline')),eraseDescriptions(await source('candidate')),'All non-description executable text must match');
}
const rows=[],contracts=[];
for(const arm of ['baseline','candidate']){
 const root=join(work,'frozen/f30',arm,'agent-runtime/dist/harness');
 const {lightSemanticHarnessTools}=await import(join(root,'light-tools.js')),{createLightCompletionTool}=await import(join(root,'light-completion.js'));
 for(const managedPreview of [false,true]){
  const received=[],executor=async call=>{received.push(call);return{status:'ok',data:{same:true}};};
  const tools=[...lightSemanticHarnessTools('/tmp/f30-contract-root',{executor,taskContract:{environment:{managedPreview}}}),createLightCompletionTool(async(summary)=>({summary}))];
  contracts.push({arm,managedPreview,tools:tools.map(t=>({name:t.name,description:t.description,inputSchema:JSON.parse(JSON.stringify(t.inputSchema)),lifecycle:t.lifecycle??null,retryable:t.retryable,maxRetries:t.maxRetries}))});
  const input={query:'calculate',scope:['src','test']};await tools[0].execute(input,{sessionId:'same',toolCallId:'same'});assert.deepEqual(received[0].input,input);
  assert.deepEqual(await tools.at(-1).execute({summary:'Counts unknown.'},{}),{summary:'Counts unknown.'});
 }
 const tests=['light-agent-navigation-guidance.test','light-agent-editing-guidance.test','light-agent-validation-guidance.test'];
 const argv=[process.execPath,'--test',...tests.map(f=>join(repo,'packages/agent-runtime/dist/harness',f+'.js'))];
 const r=spawnSync(argv[0],argv.slice(1),{cwd:repo,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,env:{...process.env,BLAME_GUIDANCE_RUNTIME:root}});assert.equal(r.status,0,r.stderr+'\n'+r.stdout);assert.match(r.stdout,/(?:# |ℹ )tests 21\b/u);
 rows.push({arm,argv,exitCode:r.status,stdout:r.stdout,stderr:r.stderr});
}
const descriptionComparison=[];
for(const managedPreview of [false,true]){
 const baseline=contracts.find(c=>c.arm==='baseline'&&c.managedPreview===managedPreview).tools,candidate=contracts.find(c=>c.arm==='candidate'&&c.managedPreview===managedPreview).tools;
 assert.deepEqual(baseline.map(({description,...t})=>t),candidate.map(({description,...t})=>t));
 for(let i=0;i<baseline.length;i++)assert.notEqual(baseline[i].description,candidate[i].description);
 const bytes=ts=>ts.reduce((n,t)=>n+Buffer.byteLength(t.description),0);
 descriptionComparison.push({managedPreview,baselineBytes:bytes(baseline),candidateBytes:bytes(candidate),relativeChange:bytes(candidate)/bytes(baseline)-1});
 assert(bytes(candidate)<bytes(baseline)*0.8);
}
await writeFile(join(study,'runtime-controls.json'),JSON.stringify({paidRequests:0,method:'All non-description executable text matches; same input schemas,lifecycle,retry policy and executor forwarding in both preview contexts. All21 existing runtime guidance contracts pass per arm. No model efficacy inferred.',rows,descriptionComparison,contracts},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({paidRequests:0,testsPerArm:21,descriptionComparison}));
