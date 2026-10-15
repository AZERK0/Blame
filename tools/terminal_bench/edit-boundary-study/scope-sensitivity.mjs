// Post-selected final-diff-only interpretation,never the registered primary grade.
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {study} from './paths.mjs';
const json=async n=>JSON.parse(await readFile(join(study,n))),results=await json('results.json'),reviews=(await json('source-review.json')).decisions,p=await json('protocol.json');
const relaxed=r=>reviews.find(d=>d.name===r.name)?.scopeOnlySensitivity===true&&r.manualCriteriaFailures.length===1&&r.manualCriteriaFailures[0]==='intermediate_source_write_outside_allowlist';
const accept=r=>r.officialRuntimeSuccess&&r.independentFunctionalSuccess&&r.agentRequiredChecksPassed&&r.noSolutionRetrieval&&r.manualBehaviorPassed&&(r.auditedCompletion||relaxed(r))&&r.usage.tokensCostReconciled;
const pairs=results.rows.filter(r=>r.arm==='candidate'&&accept(r)).flatMap(a=>{const b=results.rows.find(r=>r.arm==='baseline'&&r.id===a.id&&r.repetition===a.repetition&&accept(r));return b?[[a,b]]:[];});
const metrics={tokens:r=>r.usage.input+r.usage.output,cost:r=>r.usage.cost,seconds:r=>r.durationMs/1000},resources={};
for(const [name,value]of Object.entries(metrics)){const left=pairs.reduce((n,[a])=>n+value(a),0),right=pairs.reduce((n,[,b])=>n+value(b),0);resources[name]={left,right,pairs:pairs.length,relativeChange:right?left/right-1:null};}
await writeFile(join(study,'final-scope-only-sensitivity.json'),JSON.stringify({paidRequests:0,postSelectedSensitivity:true,method:'Relax only explicitly flagged temporary source-scope writes fully undone in a compliant final diff. Require actual checks,accepted behavior,no solution retrieval and official delivery. Never recover missing delivery,failed checks or source behavior. Original action-scope primary grades/gates stay unchanged.',relaxedTrials:results.rows.filter(r=>!r.auditedCompletion&&accept(r)).map(r=>r.name),acceptedCounts:Object.fromEntries(p.arms.map(a=>[a,results.rows.filter(r=>r.arm===a&&accept(r)).length])),pairs:pairs.length,resources},null,2)+'\n');
