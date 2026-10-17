// Preserve a vanished worker as one interrupted assignment; never launch or retry it.
import assert from 'node:assert/strict';
import {readFile,access,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {work,study,json,save,sha} from './setup.mjs';
import {score,analyse} from './run.mjs';
import {reserveTrialCosts} from '../navigation-evidence/budget-accounting.mjs';
const name=process.argv.find(a=>a.startsWith('--name='))?.slice(7);assert.ok(name);
assert.ok(process.argv.includes('--confirmed-no-live-worker'),'Check host processes before recovery');
const campaign=join(work,'campaign'),directory=join(campaign,name);
const analysis=await json(join(campaign,'analysis.json')),protocol=await json(join(study,'protocol.json'));
const slot=protocol.order[analysis.rows.length];assert.equal(name,`${slot.repeat}-${slot.task}-${slot.arm}`);
for(const path of ['result.json','model-exit.json','workspace.tar.gz'])assert.equal(await access(join(directory,path)).then(()=>true,()=>false),false,path+' already exists');
const detectedAtUTC=new Date().toISOString(),start=await json(join(directory,'model-start.json'));
const events=(await readFile(join(directory,'events.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const timestamps=events.flatMap(e=>[e.timestamp,e.event?.payload?.timestamp]).filter(x=>typeof x==='string'&&Number.isFinite(Date.parse(x)));
const lastObservedAtUTC=timestamps.sort().at(-1)??null;
const exit={code:null,signal:null,watchdog:false,durationMs:null,stderr:'',administrativeInterruption:true,
 detectedAtUTC,lastObservedAtUTC,elapsedUpperBoundMs:Date.parse(detectedAtUTC)-Date.parse(start.startedAtUTC),
 elapsedLowerBoundMs:lastObservedAtUTC?Date.parse(lastObservedAtUTC)-Date.parse(start.startedAtUTC):null,
 cause:'Worker and driver no longer present; no terminal result or exit status survived. Exact cause and termination time are unknown. Retain original assignment and partial receipts; no retry.'};
await save(join(directory,'model-exit.json'),exit);
const grade=await score(directory,slot.task);await save(join(directory,'score.json'),grade);
const {row}=await analyse(slot,directory,exit,grade);analysis.rows.push(row);await save(join(campaign,'analysis.json'),analysis);
const wire={};for(const r of analysis.rows)wire[r.name]=(await readFile(join(campaign,r.name,'wire-contracts.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
await save(join(campaign,'accounting.json'),reserveTrialCosts(analysis.rows,wire,protocol.budgets));
execFileSync('tar',['-czf',join(directory,'workspace.tar.gz'),'--exclude=workspace/node_modules','-C',directory,'workspace']);
await save(join(directory,'workspace-archive.json'),{sha256:sha(await readFile(join(directory,'workspace.tar.gz'))),includesJournal:true});
await save(join(study,'worker-interruption.json'),{name,modelRetried:false,...exit,selectedCheckExitCodes:grade.checks.map(c=>c.exitCode),recoveryScriptSha256:sha(await readFile(import.meta.filename))});
await rm(join(directory,'workspace'),{recursive:true});await rm(join(directory,'independent-endpoint'),{recursive:true});
console.log(JSON.stringify({name,official:row.officialRuntimeSuccess,functional:row.independentFunctionalSuccess,durationMs:row.durationMs,contract:row.contract}));
