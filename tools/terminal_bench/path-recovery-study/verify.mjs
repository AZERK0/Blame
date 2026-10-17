import {verifySummary} from '../confirmation-study/verify-summary.mjs';
import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';import{join,resolve}from'node:path';import{gunzipSync}from'node:zlib';
import{study as defaultStudy,json,sha}from'./setup.mjs';
const study=process.argv[2]?resolve(process.argv[2]):defaultStudy;import{reconcileUsage}from'../corpus/light-study-accounting.mjs';import{reserveTrialCosts}from'../navigation-evidence/budget-accounting.mjs';
const protocol=await json(join(study,'protocol.json')),results=await json(join(study,'results.json')),summary=await json(join(study,'summary.json')),review=await json(join(study,'source-review.json'));
assert.equal(protocol.order.length,18);assert.equal(results.rows.length,18);assert.equal(review.decisions.length,18);
const expected=protocol.order.map(s=>`${s.repeat}-${s.task}-${s.arm}`);assert.equal(new Set(expected).size,18);assert.deepEqual(results.rows.map(r=>r.name),expected);
const wireByTrial={},firstContracts={};
for(const row of results.rows){
 const zipped=await readFile(join(study,'traces',row.name+'.json.gz'));assert.equal(sha(zipped),row.traceSha256);const archive=JSON.parse(gunzipSync(zipped));assert.equal(archive.name,row.name);
 const read=name=>{const f=archive.files[name];assert.ok(f,name);const b=Buffer.from(f.base64,'base64');assert.equal(b.length,f.bytes);assert.equal(sha(b),f.sha256);return b;};
 for(const name of Object.keys(archive.files))read(name);
 for(const [name,hash]of Object.entries(row.hashes))assert.equal(sha(read(name)),hash);
 assert.equal(read('instruction.txt').toString(),protocol.tasks.find(t=>t.id===row.task).instruction);assert.deepEqual(JSON.parse(read('required-checks.json')),protocol.tasks.find(t=>t.id===row.task).requiredChecks);
 const grade=JSON.parse(read('score.json')),raw=archive.files['result.json']?JSON.parse(read('result.json')):{};
 const exit=JSON.parse(read('model-exit.json'));assert.deepEqual(row.exit,exit);assert.equal(row.durationMs,raw.durationMs??exit.durationMs);
 assert.deepEqual(row.metrics,raw.metrics??null);assert.deepEqual(row.completion,raw.completion??null);
 assert.equal(row.officialRuntimeSuccess,raw.status==='succeeded');
 assert.equal(row.independentFunctionalSuccess,grade.protectedPaths.length===0&&grade.checks.every(c=>c.exitCode===0));
 const events=read('events.jsonl').toString().trim().split('\n').filter(Boolean).map(JSON.parse).map(r=>r.event);
 // Reconstruct observed feedback use from raw events, independently of the row.
 let iteration=0;const ledger=[],starts=new Map();
 for(const [eventIndex,e]of events.entries()){if(e.type==='notice'&&e.payload?.message==='Agent iteration started.')iteration++;
  if(e.type==='tool'&&e.payload?.phase==='started')starts.set(e.payload.toolCallId??e.payload.toolCall?.id,eventIndex);
  if(e.type==='tool'&&e.payload?.phase==='finished')ledger.push({...e.payload,observedIteration:iteration,observedStartIndex:starts.get(e.payload.toolCallId??e.payload.toolCall?.id)??null,tool:e.payload.toolCall?.name??e.payload.tool,input:e.payload.toolCall?.input??e.payload.input});}
 assert.deepEqual(JSON.parse(read('tool-ledger.json')),ledger);
 const offers=[];
 for(const [index,t]of ledger.entries()){
  if(t.tool!=='read_code'||typeof t.output?.recovery!=='string')continue;
  let hint;try{hint=JSON.parse(t.output.recovery);}catch{continue;}
  if(hint.kind!=='missing_workspace_path')continue;
  const later=ledger.map((next,j)=>({next,j})).filter(({next,j})=>j>index&&next.observedIteration>t.observedIteration);
  const follow=later.find(({next})=>next.tool==='read_code'&&next.output?.status==='ok'&&hint.candidates.some(c=>next.input?.target?.replace(/^\.\//,'')===c.path));
  const navigation=later.filter(({next})=>['search_code','read_code'].includes(next.tool)&&next.observedStartIndex!==null).sort((a,b)=>a.next.observedStartIndex-b.next.observedStartIndex)[0];
  offers.push({index,observedIteration:t.observedIteration,requestedPath:hint.requestedPath,candidates:hint.candidates,followedReadIndex:follow?.j??null,directNextNavigation:!!follow&&follow.j===navigation?.j});
 }
 assert.deepEqual(row.recoveryOffers,offers);assert.equal(row.pathRecoveryOffered,offers.length);
 assert.equal(row.pathRecoveryFollowed,new Set(offers.map(o=>o.followedReadIndex).filter(i=>i!==null)).size);
 assert.equal(row.pathRecoveryDirectlyFollowed,offers.filter(o=>o.directNextNavigation).length);
 if(row.arm!=='recovery')assert.equal(offers.length,0);
 assert.ok(grade.dependencyIntegrity,'Pinned dependency comparison must be recorded');
 const iterations=events.filter(e=>e.type==='notice'&&e.payload?.message==='Agent iteration started.').length;
 const usage=reconcileUsage(raw.usage,events.filter(e=>e.type==='usage').map(e=>e.payload?.usage),iterations);assert.deepEqual(row.usage,usage);
 const wire=read('wire-contracts.jsonl').toString().trim().split('\n').filter(Boolean).map(JSON.parse);wireByTrial[row.name]=wire;firstContracts[row.name]=wire.find(w=>!w.budgetRejected);
 for(const w of wire){assert.equal(w.model,protocol.model);assert.equal(w.reasoning?.effort,protocol.effort);assert.equal(w.maximumOutputTokens,protocol.budgets.requestMaxOutputTokens);assert.equal(w.byteLimit,protocol.budgets.maximumSerializedRequestBytes);assert.equal(sha(read('schema-'+w.toolsSha256+'.json').toString().trimEnd()),w.toolsSha256);assert.equal(sha(read('prompt-'+w.promptSha256+'.json').toString().trimEnd()),w.promptSha256);}
 const d=review.decisions.find(d=>d.name===row.name);assert.deepEqual(d.hashes,row.hashes);
 const source=row.independentFunctionalSuccess&&d.sourceBehaviorPassed&&d.addedTestsPassed!==false&&d.finalSourceChecksPassed&&d.noSolutionRetrieval;
 assert.equal(row.sourceAuditedCompletion,source);assert.equal(row.appendOnlySensitivityCompletion,source&&(d.fullRequestPassed||d.complianceInterpretationSensitive===true));assert.equal(row.auditedCompletion,source&&d.fullRequestPassed);
 assert.equal(row.optionalConfigShapeSensitivityCompletion,row.independentFunctionalSuccess&&(d.sourceBehaviorPassed||d.absentOptionShapeOnlyFailure===true)&&d.addedTestsPassed!==false&&d.finalSourceChecksPassed&&d.noSolutionRetrieval);
 if(row.arm!=='cline'){assert.equal(row.metrics.context.modelRequests,null);if(row.completion?.verification==='verified')assert.fail('Unexpected source verification requires explicit investigation, not automatic acceptance');}
}
for(const slot of protocol.order.filter(s=>s.arm==='recovery')){
 const a=firstContracts[`${slot.repeat}-${slot.task}-recovery`],b=firstContracts[`${slot.repeat}-${slot.task}-reference`];
 if(a&&b){assert.equal(a.toolsSha256,b.toolsSha256);assert.equal(a.normalizedContractSha256,b.normalizedContractSha256,'Initial normalized Light contract changed beyond registered executable ablation');}
}
const frozen=await json(join(study,'execution-bindings.json'));
const trees=Object.entries(frozen.files).filter(([key])=>key.endsWith('/frozen'))[0]?.[1];
assert.ok(trees);const changed=[];for(const path of Object.keys(trees).filter(p=>p.startsWith('recovery/'))){const other='reference/'+path.slice('recovery/'.length);if(trees[path]!==trees[other])changed.push(path.slice('recovery/'.length));}
assert.deepEqual(changed,['agent-runtime/dist/harness/light-workspace.js']);
const accounting=reserveTrialCosts(results.rows,wireByTrial,protocol.budgets);assert.deepEqual(accounting,await json(join(study,'accounting.json')));
const prior=await json(join(study,'prior-budget.json'));assert.ok(prior.accountedUsd>=7.90939464);assert.ok(Math.abs(summary.cumulativeAccountedUsd-prior.accountedUsd-accounting.accountedUsd)<1e-8);
for(const arm of protocol.arms){const rows=results.rows.filter(r=>r.arm===arm),s=summary.arms[arm];assert.equal(rows.length,6);assert.equal(s.audited,rows.filter(r=>r.auditedCompletion).length);assert.equal(s.independent,rows.filter(r=>r.independentFunctionalSuccess).length);const sum=k=>rows.every(r=>r.usage[k]!==null)?rows.reduce((n,r)=>n+r.usage[k],0):null;assert.equal(s.input,sum('input'));assert.equal(s.output,sum('output'));assert.equal(s.sdkEstimatedUsd,sum('cost'));}
const archives=await json(join(study,'input-archives.json'));for(const [name,hash]of Object.entries(archives.artifacts))assert.equal(sha(await readFile(join(study,'inputs',name))),hash);
verifySummary(protocol,results.rows,summary);
console.log(JSON.stringify({trials:results.rows.length,archivesVerified:true,usageRecomputed:true,priorReservationsPreserved:true}));
