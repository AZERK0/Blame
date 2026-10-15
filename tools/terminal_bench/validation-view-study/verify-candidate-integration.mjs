// Local checks only. Never loads a model adapter or updates frozen F31 runtimes.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const repo=resolve(new URL('../../..',import.meta.url).pathname),study=join(repo,'docs/experiments/light-harness-validation-view-f32-2026-10-16'),runtime=join(repo,'packages/agent-runtime');
const sha=b=>createHash('sha256').update(b).digest('hex'),rows=[];
const run=(name,argv,cwd=repo)=>{const r=spawnSync(argv[0],argv.slice(1),{cwd,encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024});rows.push({name,argv,cwd,exitCode:r.status,error:r.error?.code??null,stdout:r.stdout??'',stderr:r.stderr??''});return r.status;};
// Invoke the already installed package tools directly: pnpm's host status hook
// attempts an unrelated workspace reinstall in this non-TTY environment.
const built=run('compile',[process.execPath,join(runtime,'node_modules/typescript/bin/tsc')],runtime);
const bindings=[];
if(built===0){
 for(const name of ['validation-output','light-task-runner']){
  const path=join('harness',name+'.js'),actual=sha(await readFile(join(runtime,'dist',path))),expected=sha(await readFile(join(repo,'.blame/research/validation-view-f32/candidate/agent-runtime/dist',path)));
  bindings.push({path,actual,expected,match:actual===expected});
 }
 assert(bindings.every(r=>r.match),'Use the temporary F32 candidate checkout; restored production deliberately retains the original presentation.');
 // tsc does not remove old dist files. Select every current source test; stale
 // compiled research prototypes are retained separately,not silently promoted.
 const tests=(await readdir(join(runtime,'src/harness'))).filter(n=>n.endsWith('.test.ts')).sort().map(n=>join(runtime,'dist/harness',n.slice(0,-3)+'.js'));
 run('all-current-harness-tests',[process.execPath,'--test',...tests]);
 run('lint',[process.execPath,join(runtime,'node_modules/eslint/bin/eslint.js'),'.'],runtime);
}
await writeFile(join(study,'production-checks.json'),JSON.stringify({paidRequests:0,node:process.version,bindings,rows,method:'Compile current source,match both executable modules to the isolated local candidate,run every current source harness test and package lint. Exclude only stale compiled files absent from source; original broad scan and pre-change reproduction retained separately. No F31 source/model/score mutation.'},null,2)+'\n');
console.log(JSON.stringify({rows:rows.map(r=>({name:r.name,exitCode:r.exitCode,summary:r.stdout.split('\n').filter(l=>/ℹ (?:tests|pass|fail)/u.test(l))})),bindings}));
assert(rows.every(r=>r.exitCode===0),JSON.stringify(rows.filter(r=>r.exitCode!==0)));assert.equal(bindings.length,2);assert(bindings.every(r=>r.match));
