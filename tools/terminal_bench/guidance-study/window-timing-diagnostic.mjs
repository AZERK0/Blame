// Post-result, zero-model diagnostic. Never changes or replaces registered scores.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {repo,work,study} from './paths.mjs';
const trial='2-rxjs-unhandled-error-migration-references',sha=b=>createHash('sha256').update(b).digest('hex');
const original=join(work,'f28',trial),scoreBytes=await readFile(join(original,'score.json'));
const score=JSON.parse(scoreBytes),diff=await readFile(join(original,'workspace.diff'));
assert.equal(score.full.exitCode,1);
assert.match(score.full.stdout,/should window when Promise resolves/);
const rows=[];
for(const endpoint of ['unchanged-input','recorded-model-endpoint']){
 const root=await mkdtemp(join(work,'window-timing-'));
 try{
  execFileSync(process.execPath,[join(repo,'tools/terminal_bench/guidance-study/run.mjs'),'prepare','f28',root,'rxjs-unhandled-error-migration'],{cwd:repo,stdio:'pipe'});
  if(endpoint==='recorded-model-endpoint')execFileSync('git',['apply','-'],{cwd:root,input:diff});
  const spec=await readFile(join(root,'spec/operators/window-spec.ts'));
  const before=execFileSync('git',['diff','--binary'],{cwd:root});
  const invocations=[];
  for(let repetition=1;repetition<=6;repetition++){
   const argv=['node_modules/node-linux-x64/bin/node','node_modules/mocha/bin/mocha','--config','spec/support/.mocharc.js',
    ...(repetition===6?['spec/**/*-spec.ts']:['spec/operators/window-spec.ts','--grep','should window when Promise resolves'])];
   const start=performance.now(),r=spawnSync(argv[0],argv.slice(1),{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,
    env:{...process.env,TZ:'UTC',TS_NODE_PROJECT:'tsconfig.mocha.json'}});
   invocations.push({repetition,scope:repetition===6?'full-suite':'targeted',argv,exitCode:r.status,signal:r.signal,error:r.error?.code??null,
    durationMs:performance.now()-start,stdout:r.stdout,stderr:r.stderr});
  }
  assert.deepEqual(execFileSync('git',['diff','--binary'],{cwd:root}),before);
  rows.push({endpoint,specSha256:sha(spec),diffSha256:sha(before),invocations});
 }finally{await rm(root,{recursive:true,force:true});}
}
assert.equal(rows[0].specSha256,rows[1].specSha256);
assert.equal(rows[1].diffSha256,sha(diff));
assert.deepEqual(await readFile(join(original,'score.json')),scoreBytes);
const result={paidRequests:0,postSelectedDiagnostic:true,trial,originalScoreSha256:sha(scoreBytes),originalDiffSha256:sha(diff),
 originalIndependentFunctionalSuccess:false,originalFullSuiteExit:score.full.exitCode,rows,
 interpretation:'The original failed full-suite score is retained. This separate same-environment finite replay cannot establish absence of flakiness, population success or model benefit. The unchanged timing-sensitive spec compares interval(3) against a Promise timer(8); byte-identical migration endpoints passed other registered invocations. Diagnostic reruns do not rescue the registered endpoint.'};
await writeFile(join(study,'window-timing-diagnostic.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({paidRequests:0,rows:rows.map(r=>({endpoint:r.endpoint,exits:r.invocations.map(i=>i.exitCode)})),originalScoreUnchanged:true}));
