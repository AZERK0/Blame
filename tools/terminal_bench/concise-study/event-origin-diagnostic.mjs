// Post-selected source-review probe. Frozen grades and endpoints stay unchanged.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {repo,work,study} from './paths.mjs';
const campaign=resolve(process.argv[3]??join(work,'f30')),destination=resolve(process.argv[2]),sha=b=>createHash('sha256').update(b).digest('hex');
const analysis=JSON.parse(await readFile(join(campaign,'analysis.json'))),protocol=JSON.parse(await readFile(join(study,'protocol.json')));
const require=createRequire(import.meta.url);
const {probe}=require('./event-origin-probes.cjs');

const upstream=join(repo,protocol.upstreams.commander.sourceRoot),control=probe(require(join(upstream,'index.js')),false,false);assert(control.passed,'Original primary-only hook must preserve origin');
const rows=[];
for(const row of analysis.rows.filter(r=>r.id==='commander-environment-fallback')){
 const root=join(campaign,row.name,'workspace'),scoreBytes=await readFile(join(campaign,row.name,'score.json')),score=JSON.parse(scoreBytes);assert.equal(sha(scoreBytes),row.scoreSha256);
 const before=Object.fromEntries(await Promise.all(Object.keys(score.sourceSha256).map(async p=>[p,sha(await readFile(join(root,p)))])));assert.deepEqual(before,score.sourceSha256);
 const api=require(join(root,'index.js')),cases=[[false,false],[true,false],[true,true]].map(args=>probe(api,...args));
 for(const [p,digest]of Object.entries(before))assert.equal(sha(await readFile(join(root,p))),digest);
 rows.push({name:row.name,arm:row.arm,repetition:row.repetition,eventsSha256:row.eventsSha256,diffSha256:row.diffSha256,scoreSha256:row.scoreSha256,sourceSha256:before,frozenIndependentFunctionalSuccess:row.independentFunctionalSuccess,sourceUnchanged:true,cases,allCasesPassed:cases.every(c=>c.passed)});
}
let authoredPositive=null;
try{
 const controlRoot=join(work,'controls/commander-environment-fallback'),registered=JSON.parse(await readFile(join(study,'task-controls.json'))).rows.find(r=>r.kind==='env-fallback');
 const sourceSha256=Object.fromEntries(await Promise.all(Object.keys(registered.authoredPositiveSourceSha256).map(async p=>[p,sha(await readFile(join(controlRoot,p)))])));
 assert.deepEqual(sourceSha256,registered.authoredPositiveSourceSha256);
 const cases=[[false,false],[true,false],[true,true]].map(args=>probe(require(join(controlRoot,'index.js')),...args));
 for(const [p,digest]of Object.entries(sourceSha256))assert.equal(sha(await readFile(join(controlRoot,p))),digest);
 authoredPositive={sourceSha256,passedOriginalFrozenControls:Object.values(registered.positive).every(r=>r.exitCode===0),sourceUnchanged:true,cases,allCasesPassed:cases.every(c=>c.passed)};
}catch(e){if(e.code!=='ENOENT')throw e;}
await writeFile(destination,JSON.stringify({paidRequests:0,postSelectedDiagnostic:true,completedPrefix:analysis.completed,recordedAtUTC:new Date().toISOString(),
 criterion:'The task explicitly requires naming the actual selected environment variable,keeping envVar as the primary string and preserving public optionEnv event arguments/hooks. A documented EventEmitter prependListener removes the already-selected variable before the internal handler. The consumed value and its origin must not be reconstructed from the now-changed environment.',
 method:'Same three cases on every completed environment-task endpoint,with original primary-only upstream control. Restore process environment after each probe; no file edits,model retries,grader feedback,source repair or rewriting frozen grades. These correlated post-selected probes are not new confirmation tasks or causal proof about wording.',control,authoredPositive,rows},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({completedPrefix:analysis.completed,endpoints:rows.length,failures:rows.filter(r=>!r.allCasesPassed).map(r=>r.name)}));
