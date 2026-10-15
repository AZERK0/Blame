import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {work,study} from './paths.mjs';
const json=async n=>JSON.parse(await readFile(join(study,n))),sha=b=>createHash('sha256').update(b).digest('hex');
try{await access(join(work,'f31'));throw Error('Campaign already exists');}catch(e){if(e.code!=='ENOENT')throw e;}
const p=await json('protocol.json'),controls=await json('task-controls.json'),runtime=await json('runtime-controls.json');assert.equal(p.readyForModel,false);
assert.equal(controls.rows.length,2);for(const c of controls.rows){assert.equal(c.unchanged.feature.exitCode,1);assert.equal(c.unchanged.selected.exitCode,1);assert(Object.values(c.positive).every(x=>x.exitCode===0));assert.equal(c.mutants.length,2);assert(c.mutants.every(m=>m.build.exitCode!==0||m.result.exitCode!==0||m.selected.exitCode!==0));assert.equal(c.protectedNegative.exitCode,1);}
assert.equal(p.order.length,18);assert.deepEqual(p.tasks,(await json('task-selection.json')).tasks);
assert.equal(runtime.rows.length,4);assert(runtime.rows.every(r=>r.exitCode===r.expectedExitCode));assert.deepEqual(runtime.contracts[0].tools,runtime.contracts[1].tools);
assert.deepEqual((await json('isolation-controls.json')).differentExecutableFiles,['harness/light-edit.js']);
assert(runtime.knownInputReplay.replays.find(r=>r.arm==='candidate').repeatedWholeReplacementStable);
assert(!runtime.knownInputReplay.replays.find(r=>r.arm==='baseline').repeatedWholeReplacementStable);
const prior=await json('prior-budget.json');assert(Math.abs(prior.observedUsd+prior.reservedUsd-prior.accountedUsd)<1e-10);
await writeFile(join(study,'protocol-pre-execution.json'),await readFile(join(study,'protocol.json')),{flag:'wx'});
p.readyForModel=true;p.finalizedAtUTC=new Date().toISOString();p.financialBinding={priorBudgetSha256:sha(await readFile(join(study,'prior-budget.json')))};
await writeFile(join(study,'protocol.json'),JSON.stringify(p,null,2)+'\n');
console.log(JSON.stringify({paidRequests:0,readyForModel:true,planned:p.order.length,priorAccountedUsd:prior.accountedUsd}));
