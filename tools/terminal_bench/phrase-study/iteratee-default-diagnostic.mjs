// Post-selected, read-only counterexample; never changes a frozen grade or model source.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {repo,work,study} from './paths.mjs';
const campaign=resolve(process.argv[2]??join(work,'f29'));
const destination=resolve(process.argv[3]??join(study,'iteratee-default-diagnostic.json'));
const sha=b=>createHash('sha256').update(b).digest('hex'),require=createRequire(import.meta.url);
const analysis=JSON.parse(await readFile(join(campaign,'analysis.json')));
const originalPath=join(repo,'.blame/research/scope-followup/upstreams/lodash/lodash.js');
const originalBytes=await readFile(originalPath),original=require(originalPath);
const inputs=[['zero',0],['false',false],['empty-string',''],['null',null],['undefined',undefined],['truthy-number',1],['object',{x:1}]];
const options=[['omitted',[]],['own-false',[{own:false}]],['own-nontrue',[{own:1}]],['own-true',[{own:true}]]];
const cases=[];
for(const method of ['forIn','forInRight'])for(const [inputLabel,value]of inputs)for(const [optionLabel,args]of options)
 cases.push({id:`${method}:${inputLabel}:${optionLabel}`,method,referenceMethod:optionLabel==='own-true'?(method==='forIn'?'forOwn':'forOwnRight'):method,inputLabel,optionLabel,value,args});
function observe(lodash,c,method=c.method){
 const saved=lodash.iteratee,sentinel=new Error('iteratee-sentinel');let calls=0,outcome;
 lodash.iteratee=()=>{calls++;throw sentinel;};
 try{const result=lodash[method](c.value,()=>{},...c.args);outcome=Object.is(result,c.value)?'returned-input':'other-return';}
 catch(error){outcome=error===sentinel?'sentinel-error':`other-error:${error.name}:${error.message}`;}
 finally{lodash.iteratee=saved;}
 return `${calls}:${outcome}`;
}
const expected=cases.map(c=>observe(original,c,c.referenceMethod));
assert(expected.some(v=>v==='1:sentinel-error')&&expected.some(v=>v==='0:returned-input'));
const rows=[];
// Assess the whole completed task cluster, not only the first discovered failure.
for(const row of analysis.rows.filter(r=>r.id==='lodash-iterator-own-mode')){
 const path=join(campaign,row.name,'workspace/lodash.js'),before=await readFile(path);
 const scoreBytes=await readFile(join(campaign,row.name,'score.json')),score=JSON.parse(scoreBytes);
 assert.equal(sha(scoreBytes),row.scoreSha256);assert.equal(sha(before),score.sourceSha256['lodash.js']);
 assert.equal(score.independentFunctionalSuccess,row.independentFunctionalSuccess);
 const lodash=require(path),observations=cases.map(c=>observe(lodash,c));
 const differences=cases.flatMap((c,i)=>observations[i]===expected[i]?[]:[{caseId:c.id,expected:expected[i],actual:observations[i]}]);
 assert.deepEqual(await readFile(path),before);
 rows.push({name:row.name,arm:row.arm,repetition:row.repetition,eventsSha256:row.eventsSha256,diffSha256:row.diffSha256,
  scoreSha256:row.scoreSha256,sourceSha256:sha(before),frozenIndependentFunctionalSuccess:row.independentFunctionalSuccess,
  assessedCases:cases.length,observations,differences,allObservedDefaultCasesMatchOriginal:differences.length===0,sourceUnchanged:true});
}
assert.deepEqual(await readFile(originalPath),originalBytes);
const result={paidRequests:0,postSelectedDiagnostic:true,recordedAtUTC:new Date().toISOString(),completedPrefix:analysis.completed,
 criterion:'The frozen task requires preserving defaults/all existing iteratee behavior and matching forOwn/forOwnRight in own mode. Original forIn/forInRight call a customized lodash.iteratee on falsy non-null inputs; original forOwn/forOwnRight skip it. Either kind of shortcut can change these observable calls/errors.',
 method:'In-memory iteratee override,restored after every call; all completed iterator-task endpoints assessed. No file edits,model retries,source repairs,oracle feedback or rewriting of frozen official/functional scores. This post hoc counterexample is not an independently preregistered confirmation or a causal attribution to ranking.',
 original:{sourceSha256:sha(originalBytes),sourceUnchanged:true},cases:cases.map(({value,args,...c})=>c),expected,rows};
await writeFile(destination,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({paidRequests:0,completedPrefix:analysis.completed,assessed:rows.length,violations:rows.filter(r=>r.differences.length).map(r=>({name:r.name,cases:r.differences.length})),destination}));
