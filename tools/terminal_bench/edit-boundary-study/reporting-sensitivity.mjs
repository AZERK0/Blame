// Registered reporting-only relaxation; source/check/scope failures stay failures.
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {study} from './paths.mjs';
const json=async n=>JSON.parse(await readFile(join(study,n))),results=await json('results.json'),reviews=(await json('source-review.json')).decisions,p=await json('protocol.json');
const relaxed=r=>reviews.find(d=>d.name===r.name)?.reportingOnlySensitivity===true&&r.manualCriteriaFailures.length===1&&r.manualCriteriaFailures[0]==='final_report_assigns_e2e_counts_to_unit_command';
const accept=r=>r.officialRuntimeSuccess&&r.independentFunctionalSuccess&&r.agentRequiredChecksPassed&&r.noSolutionRetrieval&&r.manualBehaviorPassed&&(r.auditedCompletion||relaxed(r))&&r.usage.tokensCostReconciled;
await writeFile(join(study,'reporting-only-sensitivity.json'),JSON.stringify({paidRequests:0,registeredSensitivity:true,method:'Relax only explicit reporting-only failures. Correct source,actual final-source checks,official delivery,scope and no-solution criteria remain required. Primary grades and resource gate stay unchanged.',relaxedTrials:results.rows.filter(r=>!r.auditedCompletion&&accept(r)).map(r=>r.name),acceptedCounts:Object.fromEntries(p.arms.map(a=>[a,results.rows.filter(r=>r.arm===a&&accept(r)).length]))},null,2)+'\n');
