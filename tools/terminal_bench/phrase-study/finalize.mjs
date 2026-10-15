// One-way preregistration after F28 closes; no model is called by this script.
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {repo,work,study} from './paths.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=async (root,name)=>JSON.parse(await readFile(join(root,name),'utf8'));
const put=(name,value)=>writeFile(join(study,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
try {await access(join(work,'f29'));throw Error('F29 already has a campaign directory');}
catch(error){if(error.code!=='ENOENT')throw error;}
const protocol=await read(study,'protocol.json');assert.equal(protocol.readyForModel,false);
const parentRelative='docs/experiments/light-harness-guidance-f28-2026-10-15';
const parent=join(repo,parentRelative),documents={};
for(const file of ['protocol.json','guidance-summary.json','shared-budget-accounting.json','public-replay.json','publication-controls.json','checks.json']){
 const bytes=await readFile(join(parent,file));documents[file]={sha256:sha(bytes),utf8:bytes.toString('utf8')};
}
const parsed=name=>JSON.parse(documents[name].utf8);
const summary=parsed('guidance-summary.json'),shared=parsed('shared-budget-accounting.json');
for(const name of ['guidance-summary.json','public-replay.json','checks.json']){
 assert.equal(parsed(name).completed,108);assert.equal(parsed(name).planned,108);
}
assert.equal(parsed('checks.json').reviewedTraces,108);
assert.equal(parsed('publication-controls.json').validReplayPassed,true);
assert(parsed('publication-controls.json').negativeControls.every(c=>c.rejected));
assert.equal(parsed('public-replay.json').totalAccountedUsd,summary.totalAccountedUsd);
const previous=shared.priorAccounting.map(e=>e.accounting);
const observedUsd=previous.reduce((n,e)=>n+e.observedUsd,0)+summary.accounting.observedUsd;
const reservedUsd=previous.reduce((n,e)=>n+e.reservedUsd,0)+summary.accounting.reservedUsd;
assert(Math.abs(observedUsd+reservedUsd-summary.totalAccountedUsd)<1e-10);
const local=await read(study,'local-controls.json'),runtime=await read(study,'runtime-controls.json');
assert.equal(local.rows.length,16);assert.equal(local.real.length,8);assert.equal(local.paidRequests,0);
assert.equal(runtime.rows.length,2);assert(runtime.rows.every(r=>r.exitCode===0&&/tests 21\b/u.test(r.stdout)&&/pass 21\b/u.test(r.stdout)));
const tasks=await read(study,'task-controls.json');assert.equal(tasks.rows.length,2);
for(const row of tasks.rows){
 assert.equal(row.negative.feature.exitCode,1);assert.equal(row.negative.selected.exitCode,1);
 assert(Object.values(row.positive).every(r=>r.exitCode===0));
 assert.equal(row.protectedNegative.exitCode,1);
 assert(/PASS: 6794\s+FAIL: 0\s+TOTAL: 6794/u.test(row.positive.full.stdout));
}
assert.deepEqual((await read(study,'task-selection.json')).tasks,protocol.tasks);
const isolation=await read(study,'isolation-controls.json');
assert.deepEqual(isolation.frozenModuleHashes,local.bindings);
assert.equal(isolation.unchangedSchemasPromptsEditValidationModules,true);
assert.deepEqual(isolation.differentExecutableFiles,['harness/light-navigation.js','harness/light-workspace.js']);
assert((await read(study,'prompt-date-controls.json')).rows.every(r=>r.dateFrozen&&r.realClock));
assert.equal(protocol.order.length,18);assert.equal(protocol.budgets.sharedStudyObservedCostStopUsd,parsed('protocol.json').budgets.sharedStudyObservedCostStopUsd);
const finalizedAtUTC=new Date().toISOString();
const witness=gzipSync(JSON.stringify({method:'Original public F28 financial/check documents; parent raw outcomes remain a separate cohort.',documents}),{mtime:0});
await writeFile(join(study,'parent-financial-witness.json.gz'),witness,{flag:'wx'});
const ledger={method:'Cumulative SDK estimates and explicit retained missing-usage reserves. Financial carry-forward only; no pooled outcomes or zero-imputed consumption.',
 parent:parentRelative,recordedAtUTC:finalizedAtUTC,parentCompleted:108,observedUsd,reservedUsd,accountedUsd:summary.totalAccountedUsd,
 sourceDocuments:Object.fromEntries(Object.entries(documents).map(([name,d])=>[name,d.sha256])),
 witness:{artifact:'parent-financial-witness.json.gz',sha256:sha(witness)}};
await put('prior-budget.json',ledger);
await writeFile(join(study,'protocol-pre-execution.json'),await readFile(join(study,'protocol.json')),{flag:'wx'});
protocol.readyForModel=true;protocol.finalizedAtUTC=finalizedAtUTC;
protocol.budgetAmendment.priorAccountedUsdIncludingReserves=ledger.accountedUsd;
protocol.financialBinding={priorBudgetSha256:sha(await readFile(join(study,'prior-budget.json'))),parentWitnessSha256:sha(witness)};
await writeFile(join(study,'protocol.json'),JSON.stringify(protocol,null,2)+'\n');
console.log(JSON.stringify({planned:18,readyForModel:true,paidRequests:0,priorObservedUsd:observedUsd,priorReservedUsd:reservedUsd,priorAccountedUsd:ledger.accountedUsd}));
