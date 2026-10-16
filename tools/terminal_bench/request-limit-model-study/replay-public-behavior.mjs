// Reconstruct original endpoints,never repair them or ask a model to retry.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,symlink,access,rm} from 'node:fs/promises';
import {join,resolve,isAbsolute,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {repo,work,study} from './paths.mjs';
const json=async n=>JSON.parse(await readFile(join(study,n))),sha=b=>createHash('sha256').update(b).digest('hex');
const p=await json('protocol.json'),results=await json('results.json'),bindings=await json('execution-bindings.json'),inventory=await json('inventory.json');
assert.equal(sha(await readFile(join(repo,'tools/terminal_bench/request-limit-model-study/features.mjs'))),bindings.inputs['tools/terminal_bench/request-limit-model-study/features.mjs']);
assert.equal(process.version,bindings.node,'Use the recorded Node version');
const full=process.argv.includes('--full'),install=process.argv.includes('--install-deps');
const destination=resolve(process.argv.find(a=>a.startsWith('--output='))?.slice(9)??join(work,'public-behavior-replay-last.json'));
function run(argv,cwd,options={}){const r=spawnSync(argv[0],argv.slice(1),{cwd,encoding:'utf8',timeout:120000,maxBuffer:12*1024*1024,...options,env:{...process.env,TZ:'UTC',...(options.env??{})}});return{argv,exitCode:r.status,error:r.error?.code??null,stdout:r.stdout??'',stderr:r.stderr??''};}
function extract(archive,root){const listing=run(['tar','-tf','-'],repo,{input:archive});assert.equal(listing.exitCode,0,listing.stderr);for(const path of listing.stdout.trim().split('\n'))assert(!isAbsolute(path)&&!path.split('/').includes('..'));const r=run(['tar','-xf','-','-C',root],repo,{input:archive});assert.equal(r.exitCode,0,r.stderr);}
const projects={};
for(const [name,project]of Object.entries(p.upstreams)){
 const compressed=await readFile(join(repo,project.sourceArchive));assert.equal(sha(compressed),bindings.projects[name].source);
 const archive=gunzipSync(compressed),lock=gunzipSync(await readFile(join(repo,dirname(project.sourceArchive),name+'-package-lock.json.gz')));assert.equal(sha(lock),bindings.projects[name].lock);
 const upstream=join(repo,project.sourceRoot);try{await access(join(upstream,'package.json'));}catch(e){if(e.code!=='ENOENT')throw e;await mkdir(upstream,{recursive:true});extract(archive,upstream);await writeFile(join(upstream,'package-lock.json'),lock);}
 assert.equal(sha(await readFile(join(upstream,'package-lock.json'))),sha(lock));
 for(const task of p.tasks.filter(t=>t.project===name))for(const [path,digest]of Object.entries(task.selectedSourceSha256))assert.equal(sha(await readFile(join(upstream,path))),digest);
 try{await access(join(upstream,'node_modules/typescript/bin/tsc'));}catch(e){if(e.code!=='ENOENT')throw e;assert(install,'Pinned dependencies missing; use --install-deps');const r=run(['npm','ci','--package-lock=true','--ignore-scripts','--no-audit','--no-fund'],upstream);assert.equal(r.exitCode,0,r.stderr);}
 for(const module of project.modules)assert.equal(JSON.parse(await readFile(join(upstream,'node_modules',module,'package.json'))).version,bindings.projects[name][module]);
 projects[name]={archive,upstream};
}
await mkdir(work,{recursive:true});const temporary=await mkdtemp(join(work,'public-source-replay-')),rows=[];
try{
 for(const row of results.rows){
  assert(/^[\w-]+$/u.test(row.name));const task=p.tasks.find(t=>t.id===row.id),project=projects[task.project],root=join(temporary,row.name);await mkdir(root);extract(project.archive,root);
  for(const [path,text]of Object.entries(task.inputFiles)){assert(!isAbsolute(path)&&!path.split('/').includes('..'));await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),text);}
  const item=inventory.find(i=>i.name===row.name),bytes=await readFile(join(study,item.artifact));assert.equal(sha(bytes),item.sha256);const bundle=JSON.parse(gunzipSync(bytes));const file=name=>{const f=bundle.files[name],b=Buffer.from(f.base64,'base64');assert.equal(sha(b),f.sha256);assert.deepEqual(item.files[name],{sha256:sha(b),bytes:b.length});return b;};const diff=file('workspace.diff'),scoreBytes=file('score.json'),score=JSON.parse(scoreBytes);
  assert.equal(sha(diff),row.diffSha256);assert.equal(sha(scoreBytes),row.scoreSha256);assert.equal(run(['git','init','--quiet'],root).exitCode,0);
  if(diff.length){const r=run(['git','apply','--binary','-'],root,{input:diff});assert.equal(r.exitCode,0,r.stderr);}
  await symlink(join(project.upstream,'node_modules'),join(root,'node_modules'),'dir');
  async function hashes(){for(const [path,digest]of Object.entries(score.sourceSha256))assert.equal(await readFile(join(root,path)).then(sha,e=>{if(e.code==='ENOENT')return null;throw e;}),digest,row.name+':'+path);}
  await hashes();const build=run(task.verifierCommands.build,root);assert.equal(build.exitCode,score.build.exitCode,row.name+': source build');
  const featureArgs=[process.execPath,join(repo,'tools/terminal_bench/request-limit-model-study/features.mjs'),root,task.id,study];const parse=r=>{try{return JSON.parse(r.stdout).checks.map(({name,passed})=>({name,passed}));}catch{return[];}};const r=run(featureArgs,repo),observed=parse(r);assert.equal(r.exitCode,score.featureInvocation.exitCode);
  const original=score.featureChecks.filter(c=>!c.name.startsWith('non-UTC:')).map(({name,passed})=>({name,passed}));assert.deepEqual(observed,original,row.name+': UTC probes');
  const nonUtc=run(featureArgs,repo,{env:{TZ:'America/New_York'}});assert.equal(nonUtc.exitCode,score.nonUtcFeatureInvocation.exitCode);assert.deepEqual(parse(nonUtc),score.featureChecks.filter(c=>c.name.startsWith('non-UTC:')).map(c=>({name:c.name.slice(8),passed:c.passed})),row.name+': non-UTC probes');
  const selected=run(task.verifierCommands.selected,root);assert.equal(selected.exitCode,score.selected.exitCode,row.name+': supplied tests');
  let repeated=null;if(full){repeated={};for(const key of ['types','full',...(task.verifierCommands.e2e?['e2e']:[])]){const r=run(task.verifierCommands[key],root);assert.equal(r.exitCode,score[key].exitCode,row.name+':'+key);repeated[key]=r.exitCode;}}
  await hashes();rows.push({name:row.name,sourceSha256:score.sourceSha256,diffSha256:row.diffSha256,scoreSha256:row.scoreSha256,sourceUnchangedByReplay:true,buildExitCode:build.exitCode,frozenUtcProbesMatched:true,frozenAdditionalProbeCount:observed.length,frozenNonUtcProbesMatched:true,suppliedExitCode:selected.exitCode,fullSuitesRepeated:full,...(repeated?{repeatedOriginalSuites:repeated}:{})});
  console.log(JSON.stringify({reconstructed:rows.length,name:row.name,frozenOutcomesMatched:true,fullSuitesRepeated:full}));
 }
}finally{await rm(temporary,{recursive:true,force:true});}
await writeFile(destination,JSON.stringify({paidRequests:0,method:'Fresh endpoints from public upstream/test-input archives,fixtures and original recorded diffs. Match scored source hashes,build source,repeat frozen UTC/non-UTC and supplied probes. Original grades stay unchanged. Reproducing an adverse outcome is successful replay,not successful user behavior.',node:process.version,completed:rows.length,planned:results.planned,fullSuitesRepeated:full,limitation:full?'Original type/default/E2E suites also repeated. No new model judgment or population proof.':'Original full/type/E2E outcomes remain in immutable scores; this bounded replay repeats source build,UTC/non-UTC and supplied probes.',rows},null,2)+'\n');
console.log(JSON.stringify({paidRequests:0,reconstructed:rows.length,fullSuitesRepeated:full,output:destination}));
