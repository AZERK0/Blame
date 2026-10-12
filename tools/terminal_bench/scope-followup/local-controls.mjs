// Untimed evaluator and scope controls; never repair or feed back model outputs.
import assert from "node:assert/strict";
import { readFile,writeFile,mkdir } from "node:fs/promises";
import { join,resolve } from "node:path";
import { spawnSync,execFileSync } from "node:child_process";
import { LightWorkspace } from "../../../packages/agent-runtime/dist/harness/light-workspace.js";
const repo=resolve(new URL("../../..",import.meta.url).pathname);
const study=join(repo,"docs/experiments/light-harness-scope-confirmation-2026-10-12");
const output=join(repo,".blame/research/scope-followup/",process.argv[2]==="scope"?"scope-controls":"evaluator-controls");
await mkdir(output);const observations=process.argv[2]==="scope" ? JSON.parse(await readFile(join(repo,".blame/research/scope-followup/evaluator-controls/observations.json"))).observations : [];
const protocol=JSON.parse(await readFile(join(study,"protocol.json")));
function execute(argv,cwd=repo){const r=spawnSync(argv[0],argv.slice(1),{cwd,encoding:"utf8",timeout:120000,maxBuffer:8*1024*1024,env:{...process.env,TZ:"UTC"}});return {argv,exitCode:r.status,error:r.error?.code??null,stdout:r.stdout,stderr:r.stderr};}
for(const task of process.argv[2]==="scope"?[]:protocol.tasks){
 const workspace=join(output,task.id);
 execFileSync(process.execPath,["tools/terminal_bench/scope-followup/run.mjs","prepare","confirmation",workspace,task.id],{cwd:repo});
 const file=join(workspace,Object.keys(task.mutableFunctions)[0]);
 let text=await readFile(file,"utf8");
 if(task.newTest){
  await mkdir(join(workspace,task.newTest,".."),{recursive:true});
  const test=task.project==="date-fns"
   ? 'import {test,expect} from "vitest"; import {clamp} from "../index.js"; test("reversed interval",()=>{expect(+clamp(new Date(5000),{start:new Date(9000),end:new Date(1000)})).toBe(5000)});\n'
   : 'const assert=require("node:assert/strict"),_=require("../lodash.js"); assert.equal(_.inRange(5,0,5,true),true); assert.equal(_.inRange(5,0,5),false);\n';
  await writeFile(join(workspace,task.newTest),test);
 }
 const args=[process.execPath,"tools/terminal_bench/scope-followup/feature-checks.mjs",workspace,task.id,study];
 const before=execute(args);assert.equal(before.exitCode,1,task.id+" must reject original defect/missing extension");
 if(task.seed)text=text.replace(task.seed.after,task.seed.before);
 else if(task.project==="date-fns")text=text.replace("return min([max([date_, start], options), end], options)","const [lower, upper] = +start <= +end ? [start, end] : [end, start];\n  return min([max([date_, lower], options), upper], options)");
 else text=text.replace("function inRange(number, start, end)","function inRange(number, start, end, inclusiveEnd)").replace("return baseInRange(number, start, end);","return baseInRange(number, start, end) || (inclusiveEnd === true && number === nativeMax(start, end) && number >= nativeMin(start, end));");
 await writeFile(file,text);
 const after=execute(args);assert.equal(after.exitCode,0,task.id+after.stderr);
 const grade=join(output,task.id+"-score");
 const full=execute([process.execPath,"tools/terminal_bench/scope-followup/run.mjs","score","confirmation",grade,workspace,task.id]);
 assert.equal(full.exitCode,0,full.stderr);
 const score=JSON.parse(await readFile(join(grade,"score.json")));
 assert.equal(score.independentFunctionalSuccess,true,task.id+JSON.stringify(score.featureChecks));
 // An unrelated literal change must still be rejected after correct behavior.
 const tampered=task.project==="date-fns"?text.replace('from "../','from "../../'):text.replace("var VERSION = '4.17.21'","var VERSION = '4.17.22'");
 assert.notEqual(tampered,text);await writeFile(file,tampered);
 const integrity=execute(args);assert.notEqual(integrity.exitCode,0);
 await writeFile(file,text);
 observations.push({task:task.id,before,after,unrelatedChangeRejected:integrity.exitCode!==0,score});
 await writeFile(join(output,"observations.json"),JSON.stringify({observations},null,2)+"\n");
}
const scopeRoot=join(output,"scope");await mkdir(join(scopeRoot,"src/nested"),{recursive:true});
execFileSync("git",["init","--quiet"],{cwd:scopeRoot}); // Isolate inherited parent ignore rules, as in model workspaces.
await writeFile(join(scopeRoot,"root.txt"),"uniqueScopeNeedle\n");await writeFile(join(scopeRoot,"src/inner.txt"),"uniqueScopeNeedle\n");await writeFile(join(scopeRoot,"src/nested/deep.txt"),"uniqueScopeNeedle\n");
const scope=[];
for(const engine of ["ripgrep","node"]){
 const previous=process.env.BLAME_RIPGREP_COMMAND;
 if(engine==="node")process.env.BLAME_RIPGREP_COMMAND=join(scopeRoot,"missing-rg");
 try{
  const workspace=new LightWorkspace(scopeRoot,{sessionId:engine});
  for(const [selected,expected] of [[undefined,3],["*",1],["**",3],["src",2],["src/**",2],[["root.txt","src/nested"],2]]){
   const r=await workspace.searchCode({query:"uniqueScopeNeedle",mode:"text",...(selected===undefined?{}:{scope:selected})});
   assert.equal(r.status,"ok");assert.equal(r.data.results.length,expected);
   scope.push({engine,selected:selected??null,paths:r.data.results.map(v=>v.path)});
  }
  const blocked=await workspace.searchCode({query:"uniqueScopeNeedle",scope:"../outside"});assert.equal(blocked.status,"blocked");
 }finally{if(previous===undefined)delete process.env.BLAME_RIPGREP_COMMAND;else process.env.BLAME_RIPGREP_COMMAND=previous;}
}
await writeFile(join(output,"observations.json"),JSON.stringify({observations,scope},null,2)+"\n");
console.log(JSON.stringify({behaviorAccepted:observations.length,defectsRejected:observations.length,unrelatedChangesRejected:observations.length,scopeCases:scope.length}));
