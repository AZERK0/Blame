// Independent registered grammar/behavior criteria; never supplies a repair to an agent.
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {join,resolve} from "node:path";
import {identifierTokens,onlyIdentifierRename} from "../corpus/identifier-token-audit.mjs";
import {expectedInventory,matchesInventory} from "./inventory-criteria.mjs";
import {auditMultifile} from "./multifile-criteria.mjs";
const repo=resolve(new URL("../../..",import.meta.url).pathname);
const ts=createRequire(join(repo,"packages/agent-runtime/package.json"))("typescript");
const [workspace,id,study]=process.argv.slice(2);
const protocol=JSON.parse(await readFile(join(study,"protocol.json"),"utf8"));
const task=protocol.tasks.find(t=>t.id===id);if(!task)throw Error("Unknown task");
const originalRoot=join(repo,protocol.upstreams[task.project].sourceRoot),checks=[];
const sha=v=>createHash("sha256").update(v).digest("hex");
function masked(text,names){
 const source=ts.createSourceFile("source.ts",text,ts.ScriptTarget.Latest,true);if(source.parseDiagnostics.length)throw Error("Invalid source syntax");
 const ranges=[];function visit(n){if(ts.isFunctionDeclaration(n)&&n.body&&names.includes(n.name?.text))ranges.push({name:n.name.text,start:n.getStart(source),end:n.end});ts.forEachChild(n,visit);}visit(source);
 for(const name of names)if(ranges.filter(r=>r.name===name).length!==1)throw Error("Missing/ambiguous function "+name);
 for(const r of ranges.sort((a,b)=>b.start-a.start))text=text.slice(0,r.start)+";"+text.slice(r.end);
 return identifierTokens(text);
}
for(const [path,expected] of Object.entries(task.selectedSourceSha256)){
 let original=await readFile(join(originalRoot,path),"utf8");if(sha(original)!==expected)throw Error("Original source mismatch");
 if(task.kind==="multifile-rename")continue;
 if(task.seed?.path===path){if(original.split(task.seed.before).length!==2)throw Error("Nonunique seed");original=original.replace(task.seed.before,task.seed.after);}
 const current=await readFile(join(workspace,path),"utf8");
 const passed=task.kind==="inventory" ? current===original : task.kind==="rename" ? onlyIdentifierRename(original,current,task.oldName,task.newName)
 : JSON.stringify(masked(original,task.mutableFunctions[path]??[]))===JSON.stringify(masked(current,task.mutableFunctions[path]??[]));
 checks.push({name:"registered-source-integrity:"+path,passed,sourceSha256:sha(current)});
}
if(task.kind==="multifile-rename")checks.push(...await auditMultifile(originalRoot,workspace,task));
if(task.kind==="inventory"){
 const expected=await expectedInventory(originalRoot,task.targets);
 let actual;try{actual=JSON.parse(await readFile(join(workspace,task.reportFile),"utf8"));}catch(error){if(error.code!=="ENOENT"&&!(error instanceof SyntaxError))throw error;}
 checks.push({name:"complete-exact-declaration-headers",passed:Boolean(matchesInventory(expected,actual))});
}
if(task.kind==="node-cases"){
 const _=createRequire(join(workspace,"package.json"))(join(workspace,"lodash.js"));
 const values=[undefined,null,false,true,0,-0,1,-1,1.5,-1.5,NaN,Infinity,-Infinity,"1","",[],{},Number.MAX_SAFE_INTEGER];
 checks.push({name:"registered-public-predicate",passed:values.every(value=>_[task.subject](value)===
   (task.subject==="isNil" ? value==null : Number.isInteger(value)))});
}
for(const [path,content] of Object.entries(task.inputFiles??{}))if(!task.mutableInputFiles?.includes(path))checks.push({name:"protected-task-input:"+path,passed:await readFile(join(workspace,path),"utf8")===content});
if(task.kind==="behavior"){
 const require=createRequire(join(workspace,"package.json")),_=require(join(workspace,"lodash.js")),assert=require("node:assert/strict");
 for(const a of [-Infinity,-100,-1,-0,0,1,100,Infinity,NaN,"10","2","x",null,undefined])for(const b of [-Infinity,-1,0,1,Infinity,NaN,"10","2","x",null,undefined]){
  const expected=typeof a==="string"&&typeof b==="string" ? (task.subject==="gt"?a>b:a<b) : (task.subject==="gt"?+a>+b:+a<+b);
  assert.equal(_[task.subject](a,b),expected,JSON.stringify([a,b]));
 }
 checks.push({name:"strict-relational-behavior",passed:true});
 const text=await readFile(join(workspace,task.newTest),"utf8");checks.push({name:"requested-additive-tests",passed:text.includes("comparison.test.cjs"),sourceSha256:sha(text)});
}
console.log(JSON.stringify({checks}));if(checks.some(c=>!c.passed))process.exitCode=1;
