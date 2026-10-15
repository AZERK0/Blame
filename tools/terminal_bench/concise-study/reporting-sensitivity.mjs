// Post-selected sensitivity only; never changes primary grades or decision gate.
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {study} from './paths.mjs';
const results=JSON.parse(await readFile(join(study,'results.json'))),p=JSON.parse(await readFile(join(study,'protocol.json')));
const accept=r=>r.officialRuntimeSuccess&&r.independentFunctionalSuccess&&r.agentRequiredChecksPassed&&r.noSolutionRetrieval&&r.manualBehaviorPassed&&
 (r.auditedCompletion||r.reportingOnlySensitivity===true)&&r.usage.tokensCostReconciled;
const pairs=results.rows.filter(r=>r.arm==='candidate'&&accept(r)).flatMap(a=>{const b=results.rows.find(r=>r.arm==='baseline'&&r.id===a.id&&r.repetition===a.repetition&&accept(r));return b?[[a,b]]:[];});
const metrics={tokens:r=>r.usage.input+r.usage.output,cost:r=>r.usage.cost,seconds:r=>r.durationMs/1000};
const resources=Object.fromEntries(Object.entries(metrics).map(([k,value])=>{const left=pairs.reduce((n,[a])=>n+value(a),0),right=pairs.reduce((n,[,b])=>n+value(b),0);return[k,{left,right,pairs:pairs.length,relativeChange:right?left/right-1:null}];}));
const output={paidRequests:0,postSelectedSensitivity:true,method:'Relax only explicitly flagged reporting-only failures with accepted source behavior and actual checks. Never admit the demonstrated behavior counterexample,repair code or replace primary decisions. All trial rows remain.',
 relaxedTrials:results.rows.filter(r=>!r.auditedCompletion&&r.reportingOnlySensitivity&&accept(r)).map(r=>r.name),
 acceptedCounts:Object.fromEntries(p.arms.map(a=>[a,results.rows.filter(r=>r.arm===a&&accept(r)).length])),pairs:pairs.length,resources,
 behavioralCounts:Object.fromEntries(p.arms.map(a=>[a,results.rows.filter(r=>r.arm===a&&r.manualBehaviorPassed).length]))};
await writeFile(join(study,'reporting-only-sensitivity.json'),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify({relaxedTrials:output.relaxedTrials,pairs:output.pairs,resources}));
