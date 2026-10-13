// Supervisor-only protocol gate; never placed in model workspaces or fed back.
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {createRequire} from "node:module";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {repo,work,studyFor} from "./campaign-paths.mjs";
const panel=process.argv[2],study=studyFor(panel);
const protocol=JSON.parse(await readFile(join(study,"protocol.json"),"utf8")),rows=[];
const ts=createRequire(join(repo,"packages/agent-runtime/package.json"))("typescript");
const invoke=args=>{const r=spawnSync(process.execPath,args,{cwd:repo,encoding:"utf8",timeout:180000,maxBuffer:32*1024*1024});if(r.error||r.status!==0)throw Error(r.stderr+r.stdout);return r;};
for(const task of protocol.tasks){
 const root=join(work,"controls",panel,task.id),score=join(root,"score");
 invoke(["tools/terminal_bench/navigation-evidence/run.mjs","prepare",panel,join(root,"workspace"),task.id]);
 const fail=spawnSync(process.execPath,["tools/terminal_bench/navigation-evidence/feature-checks.mjs",join(root,"workspace"),task.id,study],{cwd:repo,encoding:"utf8",timeout:10000});
 if(fail.status!==1)throw Error("Initial criteria unexpectedly fulfilled: "+task.id);
 if(task.kind==="rename")for(const path of task.allowedPaths){
  const file=join(root,"workspace",path),text=await readFile(file,"utf8"),source=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true),ranges=[];
  function visit(n){if(n.kind===ts.SyntaxKind.Identifier&&n.text===task.oldName)ranges.push([n.getStart(source),n.end]);ts.forEachChild(n,visit);}visit(source);
  let result=text;for(const [a,b] of ranges.reverse())result=result.slice(0,a)+task.newName+result.slice(b);await writeFile(file,result);
 }else{
  const file=join(root,"workspace",task.seed.path),text=await readFile(file,"utf8");await writeFile(file,text.replace(task.seed.after,task.seed.before));
  const op=task.subject==="gt"?">":"<";
  await writeFile(join(root,"workspace",task.newTest),`const {test}=require('node:test'),assert=require('node:assert/strict'),_=require('../lodash.js');\nfor(const [name,a,b] of [['comparison.test.cjs',2,1],['equality',1,1],['reversed',1,2]])test(name,()=>assert.equal(_.${task.subject}(a,b),a${op}b));\n`);
 }
 await mkdir(score,{recursive:true});invoke(["tools/terminal_bench/navigation-evidence/run.mjs","score",panel,score,join(root,"workspace"),task.id]);
 const scored=JSON.parse(await readFile(join(score,"score.json"),"utf8"));if(!scored.independentFunctionalSuccess)throw Error("Positive independent protocol gate failed: "+task.id);
 rows.push({id:task.id,initialCriteriaExit:fail.status,positiveFunctionalSuccess:true,score:scored});
}
await writeFile(join(study,"protocol-controls.json"),JSON.stringify({method:"Supervisor-only mechanical positive/negative controls, no model source repairs or oracle feedback. Not model success rows.",rows},null,2)+"\n");
console.log(JSON.stringify({panel,controls:rows.length,passed:true}));
