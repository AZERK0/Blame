// Reproduce original independent endpoint outcomes without model calls or repairs.
import assert from 'node:assert/strict';import {gunzipSync} from 'node:zlib';import {readFile,writeFile,mkdir,rm,access} from 'node:fs/promises';import{join,resolve}from'node:path';import{execFileSync,spawnSync}from'node:child_process';
import{repo,work,study,json,sha,prepare}from'./setup.mjs';
import{work as inputWork}from'../confirmation-study/setup.mjs';
const output=process.argv.find(x=>x.startsWith('--output='))?.slice(9);assert.ok(output,'Explicit --output is required');await access(resolve(output)).then(()=>{throw Error('Refusing to overwrite replay');},e=>{if(e.code!=='ENOENT')throw e;});
const protocol=await json(join(study,'protocol.json')),results=await json(join(study,'results.json'));
for(const project of protocol.projects)assert.equal(sha(await readFile(join(inputWork,'upstream',project.name+'.tar.gz'))),project.archiveSha256);
const rows=[];const root=join(work,'endpoint-replay');await mkdir(root,{recursive:true});
for(const row of results.rows){
 const archive=await readFile(join(study,'traces',row.name+'.json.gz'));assert.equal(sha(archive),row.traceSha256);const files=JSON.parse(gunzipSync(archive)).files;
 const bytes=name=>{const b=Buffer.from(files[name].base64,'base64');assert.equal(sha(b),files[name].sha256);return b;};
 const grade=JSON.parse(bytes('score.json'));const folder=join(root,row.name);await prepare(folder,row.task);
 const patch=join(root,row.name+'.patch');await writeFile(patch,bytes('workspace.diff'));
 if(bytes('workspace.diff').length)execFileSync('git',['apply','--binary',patch],{cwd:folder});
 // Original independent grader preserved protected checks; apply the same policy.
 for(const path of grade.protectedPaths){const tracked=spawnSync('git',['ls-files','--error-unmatch','--',path],{cwd:folder,stdio:'ignore'}).status===0;if(tracked)execFileSync('git',['restore','--source=HEAD','--',path],{cwd:folder});else await rm(join(folder,path),{force:true,recursive:true});}
 const checks=['regression','feature','types','upstream'].map(name=>{const p=spawnSync('npm',['run','test:study:'+name],{cwd:folder,env:{...process.env,TZ:'UTC',PATH:join(folder,'node_modules/.bin')+':'+process.env.PATH,npm_config_offline:'true',npm_config_update_notifier:'false'},encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});return{name,exitCode:p.status,signal:p.signal,error:p.error?.code??null,stdout:p.stdout,stderr:p.stderr};});
 const matches=checks.every((c,i)=>c.exitCode===grade.checks[i].exitCode&&c.signal===grade.checks[i].signal);
 rows.push({name:row.name,matches,original:grade.checks.map(c=>({exitCode:c.exitCode,signal:c.signal})),checks});
 await rm(folder,{recursive:true});await rm(patch);console.log(row.name,matches?'MATCH':'MISMATCH');
}
await writeFile(resolve(output),JSON.stringify({modelRequests:0,method:'Original patch on pristine pinned input, original protected checks, no recovered solution. Outcomes are compared to original selected-check results, not counted as new agent successes.',rows},null,2)+'\n',{flag:'wx'});if(rows.some(r=>!r.matches))process.exitCode=1;
