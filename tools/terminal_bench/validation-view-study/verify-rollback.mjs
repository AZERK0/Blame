// Verify restored production separately from the temporary F32 integration.
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const repo=resolve(new URL('../../..',import.meta.url).pathname),runtime=join(repo,'packages/agent-runtime'),study=join(repo,'docs/experiments/light-harness-validation-view-f32-2026-10-16');
const sha=b=>createHash('sha256').update(b).digest('hex'),rows=[],sourceBindings=[],moduleBindings=[];
for(const path of ['packages/agent-runtime/src/harness/validation-output.ts','packages/agent-runtime/src/harness/light-task-runner.ts','packages/agent-runtime/package.json']){
 const r=spawnSync('git',['show','b8667f0e:'+path],{cwd:repo});assert.equal(r.status,0);
 const actual=sha(await readFile(join(repo,path))),expected=sha(r.stdout);assert.equal(actual,expected);sourceBindings.push({path,actual,expected});
}
const run=(name,argv)=>{const r=spawnSync(argv[0],argv.slice(1),{cwd:runtime,encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});rows.push({name,argv,cwd:runtime,exitCode:r.status,stdout:r.stdout??'',stderr:r.stderr??''});return r.status;};
if(run('compile',[process.execPath,join(runtime,'node_modules/typescript/bin/tsc')])===0){
 for(const file of ['validation-output','light-task-runner']){
  const path='harness/'+file+'.js',actual=sha(await readFile(join(runtime,'dist',path))),expected=sha(await readFile(join(repo,'.blame/research/edit-boundaries-f31/frozen/f31/candidate/agent-runtime/dist',path)));
  moduleBindings.push({path,actual,expected});assert.equal(actual,expected);
 }
 const tests=['light-agent-validation-guidance','light-final-tests','light-required-checks','node-check-observation','node-event-evidence','npm-check-observation','project-test-command','light-whole-symbol-indent'];
 run('restored-validation-and-indent-controls',[process.execPath,'--test',...tests.map(t=>join(runtime,'dist/harness',t+'.test.js'))]);
 run('lint',[process.execPath,join(runtime,'node_modules/eslint/bin/eslint.js'),'.']);
}
const commit=spawnSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).stdout.trim();
const testAbsent=await access(join(runtime,'src/harness/light-validation-summary.test.ts')).then(()=>false,e=>{if(e.code==='ENOENT')return true;throw e;});
await writeFile(join(study,'rollback-checks.json'),JSON.stringify({paidRequests:0,commit,sourceBindings,moduleBindings,experimentalTestAbsent:testAbsent,rows,method:'Restored source/package files match the pre-F32 source;compiled presentation modules match the frozen F31 candidate. Run current validation/indentation tests and lint. No model rerun or F31 evidence mutation.'},null,2)+'\n');
assert(testAbsent&&moduleBindings.length===2&&rows.every(r=>r.exitCode===0));console.log(JSON.stringify(rows.map(r=>({name:r.name,exitCode:r.exitCode,summary:r.stdout.split('\n').filter(l=>/ℹ (?:tests|pass|fail|skipped)/u.test(l))}))));
