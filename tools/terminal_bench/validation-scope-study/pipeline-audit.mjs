// Supplemental original take/pipe regressions, uniform across all Remeda endpoints.
// Run only after model workers; never feed an audit result or repair to a model.
import assert from 'node:assert/strict';import{readFile,writeFile,mkdir,rm}from'node:fs/promises';import{join}from'node:path';import{gunzipSync}from'node:zlib';import{execFileSync,spawnSync}from'node:child_process';
import{work,study,prepare,json,save,sha}from'./setup.mjs';import{check}from'./controls.mjs';
const results=await json(join(study,'results.json')),records=[],root=join(work,'pipeline-audit');await mkdir(root);
for(const row of [null,...results.rows.filter(r=>r.task==='remeda-take-counts')]){
 const name=row?.name??'original',folder=join(root,name);await prepare(folder,'remeda-take-counts');
 if(row){const zip=await readFile(join(study,'traces',name+'.json.gz'));assert.equal(sha(zip),row.traceSha256);const files=JSON.parse(gunzipSync(zip)).files;
  const bytes=n=>{const b=Buffer.from(files[n].base64,'base64');assert.equal(sha(b),files[n].sha256);return b;};const patch=join(root,name+'.patch');await writeFile(patch,bytes('workspace.diff'));if(bytes('workspace.diff').length)execFileSync('git',['apply','--binary',patch],{cwd:folder});
  for(const path of JSON.parse(bytes('score.json')).protectedPaths){if(spawnSync('git',['ls-files','--error-unmatch','--',path],{cwd:folder,stdio:'ignore'}).status===0)execFileSync('git',['restore','--source=HEAD','--',path],{cwd:folder});else await rm(join(folder,path),{recursive:true,force:true});}
 }
 const path=join(folder,'.study/task.json'),task=await json(path);task.selected=['take','pipe'];await save(path,task);
 const checks=['delivered','delivered-types'].map(n=>check(folder,n));
 const witnessCode=`import assert from 'node:assert/strict';import{pipe,map,take,first}from'./packages/remeda/src/index.ts';for(const count of [0,-1]){const out=pipe([1,2],map(x=>x),take(count),first());console.log(JSON.stringify({count,type:typeof out,array:Array.isArray(out),value:out}));assert.equal(out,undefined);}assert.equal(pipe([1,2],take(1),first()),1);`;
 const w=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',witnessCode],{cwd:folder,encoding:'utf8',timeout:30000});
 const emptySingleWitness={exitCode:w.status,signal:w.signal,error:w.error?.code??null,stdout:w.stdout,stderr:w.stderr};
 records.push({name,hashes:row?.hashes??null,checks,emptySingleWitness,passed:checks.every(c=>c.exitCode===0)&&w.status===0});
 console.log(name,records.at(-1).passed?'PASS':'FAIL');await rm(folder,{recursive:true});
 await save(join(study,'pipeline-audit.json'),{complete:records.length===10,modelRequests:0,method:'Original take/pipe runtime and type tests plus exact added tests, pristine input or unchanged endpoint patch. Supplemental selection plus a post-hoc empty-single-result witness selected from source review; no source repair, no extra agent success, no change to original selected-check scores.',records});
}
