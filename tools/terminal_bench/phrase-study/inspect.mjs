// Read-only review view. Opaque native extra keys are not effective commands.
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {work} from "./paths.mjs";
const name=process.argv[2],mode=process.argv[3]??"inputs",root=join(work,"f29");
// The detached writer replaces analysis/ledger files between completed trials.
// Retry transient partial JSON only; original event/diff/score bytes are untouched.
const json=async p=>{
 for(let attempt=0;;attempt++){
  try{return JSON.parse(await readFile(p,"utf8"));}
  catch(error){if(attempt===9||!(error instanceof SyntaxError||error.code==="ENOENT"))throw error;await new Promise(resolve=>setTimeout(resolve,50));}
 }
};
const row=(await json(join(root,"analysis.json"))).rows.find(r=>r.name===name);if(!row)throw Error("Completed trial not found");
const score=await json(join(root,name,"score.json")),tools=(await json(join(root,"tool-ledger.json"))).find(r=>r.name===name).tools;
const normalize=s=>s.replaceAll(join(root,name,"workspace"),"<workspace>");
const finalFinish=tools.findLastIndex(t=>t.tool==="finish_task");
console.log(JSON.stringify({name,status:row.status,functional:row.independentFunctionalSuccess,tokens:row.usage.input===null?null:row.usage.input+row.usage.output,cost:row.usage.cost,seconds:row.durationMs/1000,
  failedFeatures:score.featureChecks.filter(c=>!c.passed),verifierExits:{selected:score.selected.exitCode,types:score.types.exitCode,full:score.full.exitCode},diffSha256:row.diffSha256,completion:row.completion}));
if(mode==="diff"||mode==="changes"){
 const diff=await readFile(join(root,name,"workspace.diff"),"utf8");
 console.log(mode==="diff"?diff:diff.split("\n").filter(l=>l.startsWith("diff ")||l.startsWith("+")||l.startsWith("-")).join("\n"));
}
else for(const [index,t] of tools.entries()){
 if(t.tool==="finish_task"&&index===finalFinish)continue; // Earlier attempts remain visible.
 const edit=["edit_code","apply_patch"].includes(t.tool);if(mode==="edits"&&!edit)continue;
 if(edit&&mode!=="edits"){
  const operations=t.input.operations??[{patch:t.input.input}];
  console.log(JSON.stringify({index,tool:t.tool,operations:operations.map(o=>({kind:o.kind,action:o.action,target:o.target,path:o.path,contentBytes:o.content?.length,patchBytes:o.patch?.length,
    patchHeaders:o.patch?.split("\n").filter(l=>l.startsWith("*** "))})),status:t.output?.status,message:t.output?.message,recovery:t.output?.recovery}));continue;
 }
 let input=t.input,ignored=[];
 if(t.tool==="run_commands"){
  const effective={};for(const [key,value]of Object.entries(t.input)){
   if(key==="commands")effective[key]=value;
   else ignored.push({keyPrefix:key.slice(0,90),keyBytes:key.length,sha256:createHash("sha256").update(key).digest("hex"),value});
  }input=effective;
 }
 console.log(normalize(index+" "+t.tool+" "+JSON.stringify(input)+" => "+(t.output?.status??"")+(t.output?.message?" "+t.output.message.slice(0,600):"")));
 if(t.tool==="finish_task")console.log(normalize(JSON.stringify({finishOutput:t.output})));
 if(ignored.length)console.log(JSON.stringify({ignored}));
 const tail=value=>String(value??"").split("\n").filter(line=>/[A-Za-z0-9]/u.test(line)).slice(-8).map(line=>line.slice(0,300));
 if(t.tool==="run_task"){
  const d=t.output?.data??{},completed=d.completed?.data??d;
  console.log(normalize(JSON.stringify({exitCode:completed.exitCode??null,run:d.run,process:d.process,
   check:completed.check,reporting:completed.reporting,validation:completed.validation,
   outputTail:tail(completed.output)})));
 }
 if(t.tool==="run_commands")console.log(normalize(JSON.stringify(Array.isArray(t.output)?t.output.map(r=>({success:r.success,outputTail:tail(r.result)})):t.output)));
}
const events=(await readFile(join(root,name,"events.jsonl"),"utf8")).trim().split("\n").map(s=>JSON.parse(s).event);
if(!["diff","changes"].includes(mode))console.log("FINAL "+normalize(JSON.stringify([...events].reverse().find(e=>e.type==="done")?.payload??null)));
