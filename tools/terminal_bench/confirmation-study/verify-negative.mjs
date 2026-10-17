// Negative controls for published result integrity. No model calls or source repairs.
import assert from 'node:assert/strict';
import {cp,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {study as defaultStudy,json,save} from './setup.mjs';
const study=process.argv[2]?resolve(process.argv[2]):defaultStudy;
const verifier=process.argv[3]?resolve(process.argv[3]):join(import.meta.dirname,'verify.mjs');
const pristine=spawnSync(process.execPath,[verifier,study],{encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
assert.equal(pristine.status,0,pristine.stderr);
const root=await mkdtemp(join(tmpdir(),'blame-study-integrity-')),records=[];
const cases=[
 ['drop_failed_or_successful_assignment',async dir=>{const p=join(dir,'results.json'),d=await json(p);d.rows.pop();await save(p,d);} ],
 ['alter_reported_consumption',async dir=>{const p=join(dir,'results.json'),d=await json(p);d.rows[0].usage.input+=1;await save(p,d);} ],
 ['change_audit_acceptance',async dir=>{const p=join(dir,'results.json'),d=await json(p);d.rows[0].auditedCompletion=!d.rows[0].auditedCompletion;await save(p,d);} ],
 ['alter_paired_token_delta',async dir=>{const p=join(dir,'summary.json'),d=await json(p),key=Object.keys(d.comparisons)[0];d.comparisons[key].tokenDelta=123;await save(p,d);} ],
 ['invert_retention_decision',async dir=>{const p=join(dir,'summary.json'),d=await json(p);d.resourceGate=!d.resourceGate;await save(p,d);} ],
 ['corrupt_trace_bytes',async dir=>{const d=await json(join(dir,'results.json')),p=join(dir,'traces',d.rows[0].name+'.json.gz'),b=await readFile(p);b[20]^=1;await writeFile(p,b);} ],
];
try{
 for(const[name,mutate]of cases){const dir=join(root,name);await cp(study,dir,{recursive:true});await mutate(dir);
  const p=spawnSync(process.execPath,[verifier,dir],{encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
  records.push({name,exitCode:p.status,signal:p.signal,stdout:p.stdout,stderr:p.stderr});assert.equal(p.status,1,name);assert.match(p.stderr,/AssertionError/);
  await rm(dir,{recursive:true});
 }
 await save(join(study,'verifier-negative-controls.json'),{modelRequests:0,records});console.log(JSON.stringify(records.map(r=>({name:r.name,rejected:r.exitCode!==0}))));
}finally{await rm(root,{recursive:true,force:true});}
