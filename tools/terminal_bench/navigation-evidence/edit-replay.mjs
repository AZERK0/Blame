// Replay the same known failed invocation against untouched input, never alter model results.
import {readFile,writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";
const repo=resolve(new URL("../../..",import.meta.url).pathname),work=join(repo,".blame/research/navigation-evidence");
const ledger=JSON.parse(await readFile(join(work,"f18/tool-ledger.json"),"utf8"));
const entry=ledger.find(r=>r.name==="1-lodash-baseClamp-migration-baseline"),calls=entry.tools;
const selected=calls.findIndex(t=>t.tool==="edit_code"&&t.output?.status==="blocked");
if(selected<0)throw Error("Expected known scoped failure absent");
const rows=[];
for(const arm of ["baseline","modified"]){
 const root=join(work,"edit-replay",arm,"workspace");
 const setup=spawnSync(process.execPath,["tools/terminal_bench/navigation-evidence/run.mjs","prepare","f18",root,"lodash-baseClamp-migration"],{cwd:repo,encoding:"utf8"});if(setup.status!==0)throw Error(setup.stderr);
 const {LightWorkspace}=await import(join(work,"frozen/f18",arm,"agent-runtime/dist/harness/light-workspace.js"));
 const workspace=new LightWorkspace(root,{sessionId:"replay"});let result;
 for(const call of calls.slice(0,selected+1)){
  if(call.tool==="read_code")result=await workspace.readCode(call.input,{});
  else if(call.tool==="search_code")result=await workspace.searchCode(call.input);
  else if(call.tool==="edit_code")result=await workspace.editCode(call.input);
  else throw Error("Unexpected pre-failure effect");
 }
 if(result.status!=="blocked")throw Error("Known refusal not reproduced");
 const final=await workspace.editCode(calls[selected+1].input);
 if(final.status!=="ok")throw Error("Original focused recovery failed");
 rows.push({arm,failedInput:calls[selected].input,refusal:result,responseBytes:Buffer.byteLength(JSON.stringify(result)),subsequentOriginalRecovery:final});
}
await writeFile(join(repo,"docs/experiments/light-harness-navigation-evidence-local-2026-10-13/f18-edit-replay.json"),JSON.stringify({method:"New same-invocation replay of one now-known reference model error on reconstructed unchanged initial source. Original model source/traces/scores are untouched. Both arms retain refusal and accept the original subsequent file patch; only targeted recovery information changes. No task-success or billed-token gain.",rows},null,2)+"\n");console.log(JSON.stringify(rows.map(r=>({arm:r.arm,bytes:r.responseBytes,status:r.refusal.status}))));
