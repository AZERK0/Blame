// Post-selected resolved-project interpretation, never the exact-command grade.
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {study} from './paths.mjs';
const json=async n=>JSON.parse(await readFile(join(study,n))),results=await json('results.json'),reviews=(await json('source-review.json')).decisions,p=await json('protocol.json');
const relaxed=r=>reviews.find(d=>d.name===r.name)?.resolvedProjectSensitivity===true&&r.manualCriteriaFailures.length===1&&r.manualCriteriaFailures[0]==='required_exact_npm_wrappers_not_invoked';
const accept=r=>r.officialRuntimeSuccess&&r.independentFunctionalSuccess&&(r.agentRequiredChecksPassed||relaxed(r))&&r.noSolutionRetrieval&&r.manualBehaviorPassed&&(r.auditedCompletion||relaxed(r))&&r.usage.tokensCostReconciled;
const comparisons=[];
for(const [left,right]of [['candidate','baseline'],['baseline','cline'],['candidate','cline']]){
 const pairs=results.rows.filter(a=>a.arm===left&&accept(a)).flatMap(a=>{const b=results.rows.find(b=>b.arm===right&&b.id===a.id&&b.repetition===a.repetition&&accept(b));return b?[[a,b]]:[];}),resources={};
 for(const [metric,fn]of Object.entries({tokens:r=>r.usage.input+r.usage.output,cost:r=>r.usage.cost,seconds:r=>r.durationMs/1000})){
  const a=pairs.reduce((n,[a])=>n+fn(a),0),b=pairs.reduce((n,[,b])=>n+fn(b),0);resources[metric]={left:a,right:b,relativeChange:b?a/b-1:null};
 }
 comparisons.push({left,right,pairs:pairs.length,resources});
}
await writeFile(join(study,'resolved-project-sensitivity.json'),JSON.stringify({paidRequests:0,postSelectedSensitivity:true,method:'Relax only exact npm-wrapper requirements for explicitly reviewed successful project tasks executing their resolved scripts in order. Endpoint/source behavior,all other required checks,official delivery,scope and no-solution criteria remain. Different invocation/env/lifecycle semantics are not silently equated. Primary grades/gates stay unchanged.',relaxedTrials:results.rows.filter(r=>!r.auditedCompletion&&accept(r)).map(r=>r.name),acceptedCounts:Object.fromEntries(p.arms.map(a=>[a,results.rows.filter(r=>r.arm===a&&accept(r)).length])),comparisons},null,2)+'\n');
