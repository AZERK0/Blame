import assert from 'node:assert/strict';
import {mkdir,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {work,study,prepare,save,sha} from './setup.mjs';
const startedAtUTC=new Date().toISOString(),rows=[];
const setupSha256=sha(await readFile(join(import.meta.dirname,'setup.mjs')));
await mkdir(join(work,'controls'),{recursive:true});
for(const id of ['valibot-message-prefix','valibot-hide-input','valibot-fallback-when']){
 const root=join(work,'controls',id,'workspace');await prepare(root,id,true);
 const check=()=>['regression','feature','types','upstream'].map(name=>{const p=spawnSync('npm',['run','test:study:'+name],{cwd:root,encoding:'utf8',timeout:60000,env:{...process.env,PATH:join(root,'node_modules/.bin')+':'+process.env.PATH,npm_config_cache:join(root,'../npm-cache'),npm_config_offline:'true',npm_config_update_notifier:'false'}});return{name,exitCode:p.status,signal:p.signal,stdout:p.stdout,stderr:p.stderr};});
 const before=check();execFileSync('git',['apply',join(study,'positive-'+id+'.patch')],{cwd:root});const after=check();
 rows.push({id,before,after});
 await save(join(study,'oracle-controls.json'),{startedAtUTC,endedAtUTC:new Date().toISOString(),setupSha256,modelRequests:0,complete:false,rows});
 assert.deepEqual(before.map(x=>x.exitCode),[0,1,2,0]);assert.ok(after.every(x=>x.exitCode===0));
 await rm(join(root,'..'),{recursive:true});console.log(id,'PASS');
}
await save(join(study,'oracle-controls.json'),{startedAtUTC,endedAtUTC:new Date().toISOString(),setupSha256,modelRequests:0,complete:true,rows});
