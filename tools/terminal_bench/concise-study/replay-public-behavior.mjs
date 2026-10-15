// Reconstruct archived endpoints and rerun finite probes without model access.
// Original diffs/scores/grades are never changed or repaired.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,symlink,access,rm} from 'node:fs/promises';
import {join,isAbsolute,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {gunzipSync} from 'node:zlib';
import {repo,work,study} from './paths.mjs';
const require=createRequire(import.meta.url),{probe}=require('./event-origin-probes.cjs');
const sha=b=>createHash('sha256').update(b).digest('hex'),json=async n=>JSON.parse(await readFile(join(study,n)));
const p=await json('protocol.json'),results=await json('results.json'),bindings=await json('execution-bindings.json');
assert.equal(process.version,bindings.node,'Use the recorded Node version');
const destination=resolve(process.argv.find(a=>a.startsWith('--output='))?.slice(9)??join(work,'public-behavior-replay-last.json'));
const full=process.argv.includes('--full'),install=process.argv.includes('--install-deps');
const prep=await json('preparation-controls.json'),archive=gunzipSync(await readFile(join(study,'preparation/upstream-source.tar.gz'))),lock=gunzipSync(await readFile(join(study,'preparation/upstream-package-lock.json.gz')));
assert.equal(sha(archive),bindings.projects.commander.source);assert.equal(sha(lock),bindings.projects.commander.lock);
function run(argv,cwd,options={}){const r=spawnSync(argv[0],argv.slice(1),{cwd,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,...options,env:{...process.env,TZ:'UTC',...(options.env??{})}});return{argv,exitCode:r.status,error:r.error?.code??null,stdout:r.stdout??'',stderr:r.stderr??''};}
function extract(root){const listing=run(['tar','-tf','-'],repo,{input:archive});assert.equal(listing.exitCode,0,listing.stderr);for(const path of listing.stdout.trim().split('\n'))assert(!isAbsolute(path)&&!path.split('/').includes('..'),'Unsafe archive path');const r=run(['tar','-xf','-','-C',root],repo,{input:archive});assert.equal(r.exitCode,0,r.stderr);}
const upstream=join(repo,p.upstreams.commander.sourceRoot);
try{await access(join(upstream,'package.json'));}catch(e){if(e.code!=='ENOENT')throw e;await mkdir(upstream,{recursive:true});extract(upstream);await writeFile(join(upstream,'package-lock.json'),lock);}
assert.equal(sha(await readFile(join(upstream,'package-lock.json'))),sha(lock));
for(const task of p.tasks)for(const [path,digest]of Object.entries(task.selectedSourceSha256))assert.equal(sha(await readFile(join(upstream,path))),digest,'Original control source changed');
try{await access(join(upstream,'node_modules/typescript/bin/tsc'));}catch(e){if(e.code!=='ENOENT')throw e;assert(install,'Pinned dependencies missing; rerun with --install-deps for npm ci --ignore-scripts');const r=run(['npm','ci','--ignore-scripts','--no-audit','--no-fund'],upstream);assert.equal(r.exitCode,0,r.stderr);}
for(const name of p.upstreams.commander.modules)assert.equal(JSON.parse(await readFile(join(upstream,'node_modules',name,'package.json'))).version,bindings.projects.commander[name]);
await mkdir(work,{recursive:true});const temporary=await mkdtemp(join(work,'public-source-replay-'));
const diagnostic=await json('event-origin-diagnostic.json'),rows=[];
try{
 for(const row of results.rows){
  assert(/^[\w-]+$/u.test(row.name));const task=p.tasks.find(t=>t.id===row.id),root=join(temporary,row.name);await mkdir(root);extract(root);
  for(const [path,content]of Object.entries(task.inputFiles)){assert(!isAbsolute(path)&&!path.split('/').includes('..'));await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),content);}
  const diff=gunzipSync(await readFile(join(study,'traces',row.name+'.workspace.diff.gz'))),scoreBytes=gunzipSync(await readFile(join(study,'traces',row.name+'.score.json.gz'))),score=JSON.parse(scoreBytes);
  assert.equal(sha(diff),row.diffSha256);assert.equal(sha(scoreBytes),row.scoreSha256);
  assert.equal(run(['git','init','--quiet'],root).exitCode,0);
  if(diff.length){const applied=run(['git','apply','--binary','-'],root,{input:diff});assert.equal(applied.exitCode,0,applied.stderr);}
  await symlink(join(upstream,'node_modules'),join(root,'node_modules'),'dir');
  for(const [path,digest]of Object.entries(score.sourceSha256))assert.equal(sha(await readFile(join(root,path))),digest,row.name+':'+path);
  const features=run([process.execPath,join(repo,'tools/terminal_bench/concise-study/features.mjs'),root,task.id],repo);
  const observed=JSON.parse(features.stdout).checks.map(({name,passed})=>({name,passed}));
  const original=score.featureChecks.filter(c=>!c.name.startsWith('non-UTC:')).map(({name,passed})=>({name,passed}));assert.deepEqual(observed,original,row.name+': frozen UTC probes');
  const selected=run(task.verifierCommands.selected,root);assert.equal(selected.exitCode,score.selected.exitCode,row.name+': supplied tests');
  let eventOrigin=null;if(task.kind==='env-fallback'){
   const api=require(join(root,'index.js'));eventOrigin=[[false,false],[true,false],[true,true]].map(args=>probe(api,...args));
   assert.deepEqual(eventOrigin,diagnostic.rows.find(r=>r.name===row.name).cases,row.name+': supplementary hook outcomes');
  }
  const extra=full?{types:run(task.verifierCommands.types,root),full:run(task.verifierCommands.full,root)}:null;
  if(extra)for(const [key,value]of Object.entries(extra))assert.equal(value.exitCode,score[key].exitCode,row.name+':'+key);
  for(const [path,digest]of Object.entries(score.sourceSha256))assert.equal(sha(await readFile(join(root,path))),digest);
  rows.push({name:row.name,sourceSha256:score.sourceSha256,diffSha256:row.diffSha256,scoreSha256:row.scoreSha256,sourceReconstructedExactly:true,sourceUnchangedByReplay:true,frozenUtcProbesMatched:true,frozenPrivateProbeCount:observed.length,suppliedExitCode:selected.exitCode,eventOrigin,fullSuitesRepeated:full,...(extra?{typesExitCode:extra.types.exitCode,fullExitCode:extra.full.exitCode}:{})});
 }
}finally{await rm(temporary,{recursive:true,force:true});}
const result={paidRequests:0,method:'Fresh temporary endpoints from archived upstream tar,input fixtures and exact recorded diffs. Match every scored source hash,rerun frozen UTC behavior/type probes and supplied tests,then reproduce supplementary event-hook outcomes. No reference solution retrieval,source repair,model retry,grader feedback or original grade changes. Reproducing an adverse result is successful replay,not successful user behavior.',node:process.version,completed:rows.length,planned:results.planned,fullSuitesRepeated:full,limitation:full?'Full JS/TS and project suites also repeated on reconstructed sources; execution still does not establish all user criteria.':'Original full-suite/JS-TS outcomes remain in immutable scores; this bounded replay repeats private UTC and supplied probes plus supplementary hooks,not the complete original suite or non-UTC panel.',rows};
await writeFile(destination,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({paidRequests:0,reconstructed:rows.length,fullSuitesRepeated:full,output:destination}));
