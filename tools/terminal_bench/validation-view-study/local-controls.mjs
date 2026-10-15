// No model calls. Freeze a presentation-only pair and run identical controls.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,cp,symlink,readdir,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import ts from '../../../packages/agent-runtime/node_modules/typescript/lib/typescript.js';
const repo=resolve(new URL('../../..',import.meta.url).pathname),work=join(repo,'.blame/research/validation-view-f32'),study=join(repo,'docs/experiments/light-harness-validation-view-f32-2026-10-16');
const baseline=process.env.BLAME_VALIDATION_BASELINE_RUNTIME??join(repo,'.blame/research/edit-boundaries-f31/frozen/f31/candidate/agent-runtime'),candidate=join(work,'candidate/agent-runtime'),testRoot=join(work,'tests');
const sha=b=>createHash('sha256').update(b).digest('hex');
const sourceRoot=join(work,'source-pairs/packages/agent-runtime/src/harness');
try{await access(join(sourceRoot,'validation-output.ts'));}catch(error){
 if(error.code!=='ENOENT')throw error;await mkdir(sourceRoot,{recursive:true});
 for(const name of ['validation-output','light-task-runner']){
  const r=spawnSync('git',['show','b8667f0e:packages/agent-runtime/src/harness/'+name+'.ts'],{cwd:repo});assert.equal(r.status,0);
  await writeFile(join(sourceRoot,name+'.ts'),r.stdout);
 }
 const r=spawnSync('git',['apply','--directory=.blame/research/validation-view-f32/source-pairs',join(study,'candidate.patch')],{cwd:repo,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
}
await mkdir(candidate,{recursive:true});await mkdir(testRoot,{recursive:true});
await cp(join(baseline,'dist'),join(candidate,'dist'),{recursive:true});
await cp(join(baseline,'package.json'),join(candidate,'package.json'));
await symlink(join(repo,'packages/agent-runtime/node_modules'),join(candidate,'node_modules'),'dir').catch(e=>{if(e.code!=='EEXIST')throw e;});
const transpile=async(source,destination)=>{const text=await readFile(source,'utf8'),r=ts.transpileModule(text,{fileName:source,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});await writeFile(destination,r.outputText);};
for(const file of ['validation-output','light-task-runner'])await transpile(join(work,'source-pairs/packages/agent-runtime/src/harness',file+'.ts'),join(candidate,'dist/harness',file+'.js'));
await transpile(join(repo,'tools/terminal_bench/validation-view-study/validation-summary.test.ts'),join(testRoot,'validation-summary.test.js'));
await cp(join(baseline,'dist/harness/light-agent-guidance-fixture.js'),join(testRoot,'light-agent-guidance-fixture.js'));await writeFile(join(testRoot,'package.json'),'{"type":"module"}\n');
async function files(root,prefix=''){const out={};for(const d of await readdir(join(root,prefix),{withFileTypes:true})){const path=join(prefix,d.name);if(d.isDirectory())Object.assign(out,await files(root,path));else out[path]=sha(await readFile(join(root,path)));}return out;}
const left=await files(join(baseline,'dist')),right=await files(join(candidate,'dist'));
assert.deepEqual(Object.keys(left).sort(),Object.keys(right).sort());const changed=Object.keys(left).filter(k=>left[k]!==right[k]).sort();assert.deepEqual(changed,['harness/light-task-runner.js','harness/validation-output.js']);
const rows=[];
for(const [arm,root]of [['baseline',baseline],['candidate',candidate]]){
 const runtime=join(root,'dist/harness'),argv=[process.execPath,'--test',join(testRoot,'validation-summary.test.js')],r=spawnSync(argv[0],argv.slice(1),{cwd:repo,env:{...process.env,BLAME_GUIDANCE_RUNTIME:runtime},encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});
 rows.push({arm,argv,exitCode:r.status,stdout:r.stdout,stderr:r.stderr,runtime});
}
await writeFile(join(study,'local-controls.json'),JSON.stringify({paidRequests:0,node:process.version,typescript:ts.version,baselineSourceCommit:'b8667f0e99c6ab5c5782d3d6bfdf91db9e58ba50',candidatePatchSha256:sha(await readFile(join(study,'candidate.patch'))),testSourceSha256:sha(await readFile(join(repo,'tools/terminal_bench/validation-view-study/validation-summary.test.ts'))),changedModules:changed,moduleBindings:{baseline:left,candidate:right},rows},null,2)+'\n');
console.log(JSON.stringify(rows.map(r=>({arm:r.arm,exit:r.exitCode,summary:r.stdout.split('\n').filter(l=>/ℹ (?:tests|pass|fail)|not ok/u.test(l))}))));
assert.equal(rows[0].exitCode,1,'Old presentation should fail the visibility controls');assert.match(rows[0].stdout,/tests 8\b/u);assert.match(rows[0].stdout,/fail 6\b/u);assert.equal(rows[1].exitCode,0,rows[1].stderr+rows[1].stdout);
