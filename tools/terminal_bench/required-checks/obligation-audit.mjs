// Read-only post-hoc route/proof extraction; never change primary scores.
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const [campaign,study]=process.argv.slice(2).map(value=>resolve(value));
const json=async path=>JSON.parse(await readFile(path,"utf8"));
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const analysis=await json(join(campaign,"analysis.json")),protocol=await json(join(study,"protocol.json"));
const rows=[];
for(const row of analysis.rows){
  const task=protocol.tasks.find(t=>t.id===row.id);
  const metadata=await readFile(join(campaign,row.name,"required-checks.json"));
  assert.deepEqual(JSON.parse(metadata),task.requiredChecks);
  const records=[];
  try{for(const name of await readdir(join(campaign,row.name,"workspace/.blame/harness/light")))
    if(name.endsWith(".jsonl")) records.push(...(await readFile(join(campaign,row.name,"workspace/.blame/harness/light",name),"utf8")).split("\n").filter(Boolean).map(JSON.parse));
  }catch(error){if(error.code!=="ENOENT")throw error;}
  const events=records.filter(e=>e.type==="validation"&&e.taskKind==="test"&&
    (!row.completion?.source_revision_id||e.sourceRevisionId===row.completion.source_revision_id));
  rows.push({name:row.name,arm:row.arm,eventsSha256:row.eventsSha256,metadataSha256:sha(metadata),
    requiredChecks:task.requiredChecks,admissionAsReported:row.completion,
    currentReportedTests:events.map(e=>({command:e.command,taskId:e.taskId,args:e.args??[],cwd:e.cwd,
      sourceRevisionId:e.sourceRevisionId,status:e.status,check:e.check})),
    actualUserChecksAuditedSeparately:true});
}
await writeFile(join(study,"obligation-audit.json"),JSON.stringify({
  method:"Post-hoc descriptive extraction of unchanged journal/CLI metadata and reported final-source proof. All arms received identical transport metadata; public runtime/SDK determines whether consumed. Actual post-final-edit user commands/criteria are assessed separately in the primary SHA-bound review. check:ID means reported passing execution, never test scope or full acceptance. Missing Cline Light admission is null, not failed.",rows
},null,2)+"\n");
console.log(JSON.stringify({rows:rows.length,metadataMatched:rows.length}));
