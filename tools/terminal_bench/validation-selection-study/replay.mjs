// Known F44 endpoint, reconstructed invocation sequence; no model or source repair.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,access,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {execFileSync,spawnSync} from 'node:child_process';
import {prepare,study,repo,sha,json} from '../validation-scope-study/setup.mjs';
const runtime=resolve(process.argv[2]),output=resolve(process.argv[3]);
await access(output).then(()=>{throw Error('Refusing to overwrite evidence');},e=>{if(e.code!=='ENOENT')throw e;});
const runtimeHashes={};for(const file of ['check-observation.js','light-task-runner.js','light-finish-service.js','light-validation-report.js'])runtimeHashes[file]=sha(await readFile(join(runtime,file)));
const researcherCodeCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
const load=name=>import(pathToFileURL(join(runtime,name+'.js')));
const {WorkspaceFiles}=await load('workspace-files'),{SessionJournal}=await load('session-journal');
const {LightTaskRunner}=await load('light-task-runner'),{LightFinishService}=await load('light-finish-service');
const name='2-remeda-take-counts-scope',row=(await json(join(study,'results.json'))).rows.find(r=>r.name===name);
const archive=await readFile(join(study,'traces',name+'.json.gz'));assert.equal(sha(archive),row.traceSha256);
const payload=JSON.parse(gunzipSync(archive)).files;
const bytes=n=>{const b=Buffer.from(payload[n].base64,'base64');assert.equal(sha(b),payload[n].sha256);return b;};
const grade=JSON.parse(bytes('score.json')),ledger=JSON.parse(bytes('tool-ledger.json'));
const parent=join('/tmp/blame-validation-selection-f45',output.split('/').at(-1).replace(/\.json$/,'')),root=join(parent,'workspace');
await mkdir(parent,{recursive:true});await prepare(root,'remeda-take-counts',true);
Object.assign(process.env,(await json(join(parent,'environment.json'))).env);
const patch=join(parent,'original.patch');await writeFile(patch,bytes('workspace.diff'));execFileSync('git',['apply','--binary',patch],{cwd:root});
assert.deepEqual(grade.protectedPaths,[]);
const files=new WorkspaceFiles(root),journal=new SessionJournal(root,'selection-replay');
const sourceRevisionId=(await files.snapshot()).revision.source_revision_id;
await journal.recordChange({paths:grade.changedPaths,sourceRevisionId,receipt:'reconstructed-archived-endpoint',symbols:[],parse:'not_supported'});
const tasks=new LightTaskRunner({files,journal,initialCommandWaitMs:60000}),checks=[];
for(const id of ['regression','feature','types','upstream'])checks.push(await tasks.run({kind:'project',task:'test:study:'+id}));
const bad=await tasks.run(ledger[61].input);assert.equal(bad.data?.exitCode,1);
const broad=await tasks.run({kind:'project',task:'remeda:test'});
assert.equal(broad.data?.exitCode,0,JSON.stringify(broad));assert.ok(broad.data.check.counts.executed>3800);
const attempts=[];
for(const requireBad of [false,true]){
 const notifications=[],activities=[];
 const required_checks=['regression','feature','types','upstream'].map(id=>({id,task:'test:study:'+id}));
 if(requireBad)required_checks.push({id:'exact-selection',task:'remeda:test',args:ledger[61].input.args});
 const finish=new LightFinishService({workspaceRoot:root,conversationId:'selection-replay',taskContract:{required_checks},onComplete:n=>notifications.push(n),onValidationActivity:a=>activities.push(a)});
 const errors=[];for(let n=0;n<2;n++)try{await finish.finish('Replayed commands only; source correctness remains unaudited.',{});}catch(e){errors.push(e.message);}
 attempts.push({requireBad,errors,notifications,activities});
}
const witness=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',"import assert from 'node:assert/strict';import{pipe,map,take,first}from'./packages/remeda/src/index.ts';assert.equal(pipe([1,2],map(x=>x),take(0),first()),undefined);"],{cwd:root,encoding:'utf8',timeout:30000});
assert.equal(witness.status,1,'This replay must not repair the separate endpoint semantic defect');
const sourceHashes={};for(const path of grade.changedPaths){sourceHashes[path]=sha(await readFile(join(root,path)));assert.equal(sourceHashes[path],grade.sourceHashes[path]);}
const result={modelRequests:0,method:'Reconstruct the unchanged published F44 endpoint and its known bad selector followed by the same full package task. Journal changes are newly recorded, not a claim to replay the original conversation. Both arms run identical four required checks. No source repair, task-success or token-saving counterfactual.',runtime,runtimeHashes,researcherCodeCommit,endpoint:name,traceSha256:row.traceSha256,sourceHashes,checks,bad,broad,attempts,journal:await journal.completionSnapshot(),semanticWitness:{exitCode:witness.status,stdout:witness.stdout,stderr:witness.stderr}};
for(const [file,hash]of Object.entries(runtimeHashes))assert.equal(sha(await readFile(join(runtime,file))),hash,'Runtime changed during replay');
await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});await rm(root,{recursive:true});
console.log(JSON.stringify({output,category:bad.data.failure.category,attempts:attempts.map(a=>({requireBad:a.requireBad,errors:a.errors,completion:a.notifications.at(-1)?.completion,automaticRuns:a.activities.filter(x=>x.phase==='started').length}))}));
