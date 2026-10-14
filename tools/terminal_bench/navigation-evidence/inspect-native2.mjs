// Read-only review view. Opaque native extra keys are not effective commands.
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {work} from "./campaign-paths.mjs";
const name=process.argv[2],mode=process.argv[3]??"inputs",root=join(work,"f27"),json=async p=>JSON.parse(await readFile(p,"utf8"));
const row=(await json(join(root,"analysis.json"))).rows.find(r=>r.name===name);if(!row)throw Error("Completed trial not found");
const score=await json(join(root,name,"score.json")),tools=(await json(join(root,"tool-ledger.json"))).find(r=>r.name===name).tools;
const normalize=s=>s.replaceAll(join(root,name,"workspace"),"<workspace>");
console.log(JSON.stringify({name,status:row.status,functional:row.independentFunctionalSuccess,tokens:row.usage.input===null?null:row.usage.input+row.usage.output,cost:row.usage.cost,seconds:row.durationMs/1000,
  failedFeatures:score.featureChecks.filter(c=>!c.passed),verifierExits:{selected:score.selected.exitCode,types:score.types.exitCode,full:score.full.exitCode},diffSha256:row.diffSha256,completion:row.completion}));
if(mode==="diff")console.log(await readFile(join(root,name,"workspace.diff"),"utf8"));
else for(const [index,t] of tools.entries()){
 const edit=["edit_code","apply_patch"].includes(t.tool);if(mode==="edits"&&!edit)continue;
 if(edit&&mode!=="edits"){
  const operations=t.input.operations??[{patch:t.input.input}];
  console.log(JSON.stringify({index,tool:t.tool,operations:operations.map(o=>({kind:o.kind,action:o.action,target:o.target,path:o.path,contentBytes:o.content?.length,patchBytes:o.patch?.length,
    patchHeaders:o.patch?.split("\n").filter(l=>l.startsWith("*** "))})),status:t.output?.status,message:t.output?.message}));continue;
 }
 let input=t.input,ignored=[];
 if(t.tool==="run_commands"){
  const effective={};for(const [key,value]of Object.entries(t.input)){
   if(["commands","timeout_ms","cwd"].includes(key))effective[key]=value;
   else ignored.push({keyPrefix:key.slice(0,90),keyBytes:key.length,sha256:createHash("sha256").update(key).digest("hex"),value});
  }input=effective;
 }
 console.log(normalize(JSON.stringify({index,tool:t.tool,input,ignored:ignored.length?ignored:undefined,status:t.output?.status,message:t.output?.message})));
 if(["run_task","run_commands"].includes(t.tool))console.log(normalize(JSON.stringify(t.output).slice(-800)));
}
const events=(await readFile(join(root,name,"events.jsonl"),"utf8")).trim().split("\n").map(s=>JSON.parse(s).event);
console.log("FINAL "+normalize(JSON.stringify([...events].reverse().find(e=>e.type==="done")?.payload??null)));
