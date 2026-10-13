// Verify published wire contracts and exact owned Node report hashes alongside
// the separate unchanged-raw/source evidence verifier.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { repo, studyFor } from "./campaign-paths.mjs";
assert.equal(process.env.BLAME_STUDY_VARIANT,"confirm2");
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const json=async path=>JSON.parse(await readFile(path,"utf8"));
const panels=[];
for(const panel of ["f22","f21","f23"]){
 const study=studyFor(panel),protocol=await json(join(study,"protocol.json"));
 const inventory=await json(join(study,"wire-inventory.json"));
 const bytes=await readFile(join(study,inventory.artifact));assert.equal(sha(bytes),inventory.sha256);
 const wire=JSON.parse(gunzipSync(bytes));let records=0;
 const schemas=new Map();
 for(const trial of wire.trials){
  if(trial.missing)continue;
  assert.equal(sha(trial.requests.map(r=>JSON.stringify(r)+"\n").join("")),trial.metadataSha256);
  for(const artifact of trial.artifacts)
   assert.equal(sha(JSON.stringify(wire.contracts[artifact.file])+"\n"),artifact.sha256);
  for(const request of trial.requests){
   records++;assert.equal(request.model,protocol.model);assert.equal(request.reasoning.effort,protocol.effort);
   for(const [kind,digest] of [["schema",request.toolsSha256],["prompt",request.promptSha256]])
    assert.equal(sha(JSON.stringify(wire.contracts[kind+"-"+digest+".json"])),digest);
   const tools=wire.contracts["schema-"+request.toolsSha256+".json"];
   const names=tools.map(t=>t.name??t.function?.name);
   const cline=trial.name.endsWith("-cline");
   assert.deepEqual([...names].sort(),(cline
    ?["read_files","search_codebase","run_commands","fetch_web_content","apply_patch"]
    :["skills","fetch_web_content","search_code","read_code","edit_code","run_task","finish_task"]).sort());
   assert.equal(request.toolCount,names.length);
   if(!cline&&panel==="f22"){
    const read=tools.find(t=>(t.name??t.function?.name)==="read_code");
    const parameters=read.parameters??read.function?.parameters;
    assert.equal(parameters.properties.view.enum.includes("signature"),!trial.name.endsWith("-baseline"));
   }
   schemas.set(cline?"cline":"light",names);
   if(panel!=="f22"){
    assert.equal(request.byteLimit,protocol.budgets.maximumSerializedRequestBytes);
    assert.equal(request.budgetRejected,request.requestBytes>request.byteLimit);
   }
  }
 }
 assert.equal(records,inventory.requests);
 const node=await json(join(study,"node-report-inventory.json"));
 for(const report of node.reports)
  assert.equal(sha(gunzipSync(await readFile(join(study,report.artifact)))),report.sha256);
 panels.push({panel,wireRecordsVerified:records,schemas:Object.fromEntries(schemas),nodeReportsVerified:node.reports.length,
   missingExpectedNodeReports:node.missingExpectedReports.length});
}
const root=join(repo,"docs/experiments/light-harness-mechanism-confirmation-2026-10-13");
await writeFile(join(root,"evidence-checks.json"),JSON.stringify({method:"Published actual-wire public-contract/metadata hashes, model/effort/tool set, amended byte guard, and exact owned Node report hashes. Body hashes cannot be reconstructed: private conversation request bodies are intentionally unarchived. Raw trial/source hashes are verified separately.",panels},null,2)+"\n");
console.log(JSON.stringify(panels.map(p=>({panel:p.panel,wire:p.wireRecordsVerified,node:p.nodeReportsVerified}))));
