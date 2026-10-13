// Archive only public schemas/prompts and request metadata. No request messages,
// auth headers, query strings, credentials or full request bodies are archived.
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { gzipSync } from "node:zlib";
const campaign=resolve(process.argv[2]), study=resolve(process.argv[3]);
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const analysis=JSON.parse(await readFile(join(campaign,"analysis.json"),"utf8"));
const trials=[], contracts={};
for(const row of analysis.rows){
  const directory=join(campaign,row.name);
  let wire;try{wire=await readFile(join(directory,"wire-contracts.jsonl"));}
  catch(error){if(error.code!=="ENOENT")throw error;trials.push({name:row.name,missing:true});continue;}
  const requests=wire.toString().trim().split("\n").filter(Boolean).map(JSON.parse);
  const artifacts=[];
  for(const file of (await readdir(directory)).filter(f=>/^(schema|prompt)-[a-f0-9]{64}\.json$/u.test(f))){
    const bytes=await readFile(join(directory,file));
    const content=JSON.parse(bytes.toString());
    if(sha(JSON.stringify(content))!==file.slice(file.indexOf("-")+1,-5))throw Error("Contract hash mismatch");
    contracts[file]=content;artifacts.push({file,bytes:bytes.length,sha256:sha(bytes)});
  }
  trials.push({name:row.name,metadataSha256:sha(wire),requests,artifacts});
}
const bytes=gzipSync(JSON.stringify({method:"Unmodified public schemas/prompts and whitelisted metadata from actual fetch dispatch; original F22 records lack byte counts. Budget-rejected records are attempts, not dispatched paid requests.",contracts,trials}),{mtime:0});
await writeFile(join(study,"wire-contracts.json.gz"),bytes);
const inventory={artifact:"wire-contracts.json.gz",sha256:sha(bytes),trials:trials.length,
  missing:trials.filter(t=>t.missing).length,requests:trials.reduce((s,t)=>s+(t.requests?.length??0),0),
  budgetRejected:trials.reduce((s,t)=>s+(t.requests?.filter(r=>r.budgetRejected).length??0),0),
  wireOutputLimitPresent:trials.reduce((s,t)=>s+(t.requests?.filter(r=>r.maximumOutputTokens!==null).length??0),0)};
await writeFile(join(study,"wire-inventory.json"),JSON.stringify(inventory,null,2)+"\n");
console.log(JSON.stringify(inventory));
