import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {repo,work,study} from './paths.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),json=async name=>JSON.parse(await readFile(join(study,name)));
try{await access(join(work,'f30'));throw Error('Campaign already exists');}catch(e){if(e.code!=='ENOENT')throw e;}
const p=await json('protocol.json');assert.equal(p.readyForModel,false);
const controls=await json('task-controls.json');assert.equal(controls.rows.length,3);
for(const r of controls.rows){assert.equal(r.unchanged.feature.exitCode,1);assert.equal(r.unchanged.selected.exitCode,1);assert(Object.values(r.positive).every(x=>x.exitCode===0));assert(r.mutants.length>=2&&r.mutants.every(m=>m.result.exitCode===1));assert.equal(r.protectedNegative.exitCode,1);}
assert.deepEqual((await json('task-selection.json')).tasks,p.tasks);assert.equal(p.order.length,27);
const runtime=await json('runtime-controls.json');assert.equal(runtime.rows.length,2);assert(runtime.rows.every(r=>r.exitCode===0));assert(runtime.descriptionComparison.every(r=>r.relativeChange<-.2));
assert.deepEqual((await json('isolation-controls.json')).differentExecutableFiles,['harness/light-completion.js','harness/light-tools.js']);
assert((await json('prompt-date-controls.json')).rows.every(r=>r.dateFrozen&&r.realClock));
const prior=await json('prior-budget.json');assert(Math.abs(prior.observedUsd+prior.reservedUsd-prior.accountedUsd)<1e-10);
assert.equal(sha(await readFile(join(study,'parent-financial-witness.json.gz'))),prior.witness.sha256);
assert.equal((await json('strengthened-evaluation-controls.json')).originalGradesUnchanged,true);
await writeFile(join(study,'protocol-pre-execution.json'),await readFile(join(study,'protocol.json')),{flag:'wx'});
p.readyForModel=true;p.finalizedAtUTC=new Date().toISOString();p.financialBinding={priorBudgetSha256:sha(await readFile(join(study,'prior-budget.json')))};
await writeFile(join(study,'protocol.json'),JSON.stringify(p,null,2)+'\n');
console.log(JSON.stringify({paidRequests:0,readyForModel:true,planned:27,priorAccountedUsd:prior.accountedUsd}));
