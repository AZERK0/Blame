// Integrity assertions independent of whether any arm wins or loses.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {gunzipSync} from "node:zlib";
import {repo,work,studyFor} from "./campaign-paths.mjs";
const study=studyFor("f27"),campaign=join(work,"f27"),json=async p=>JSON.parse(await readFile(p,"utf8"));
const sha=b=>createHash("sha256").update(b).digest("hex");
const results=await json(join(study,"results.json")),protocol=await json(join(study,"protocol.json"));
const bindings=await json(join(study,"execution-bindings.json"));
assert.equal(results.planned,protocol.tasks.length*protocol.repetitions*protocol.arms.length);
assert.equal(results.provenance.protocolSha256,sha(await readFile(join(study,"protocol.json"))));
assert.deepEqual(results.provenance.frozen,bindings);
for(const [path,expected] of Object.entries(bindings.inputs))assert.equal(sha(await readFile(join(repo,path))),expected,path);
assert.deepEqual((await json(join(study,"freeze-isolation.json"))).differentFiles,["harness/light-edit.d.ts.map","harness/light-edit.js"]);
const heads={};
for(const row of results.rows) {
  const root=join(campaign,row.name,"workspace");
  const git=argv=>execFileSync("git",argv,{cwd:root,encoding:"utf8"}).trim();
  const task=protocol.tasks.find(t=>t.id===row.id);
  const original=git(["rev-list","--max-parents=0","HEAD"]);
  heads[row.name]={initialHead:original,initialTree:git(["rev-parse",original+"^{tree}"])};
  assert.equal(Date.parse(git(["show","-s","--format=%cI",original])),Date.parse(protocol.taskInputCommitAtUTC));
  for(const [path,content] of Object.entries(task.inputFiles??{}))if(!task.mutableInputFiles?.includes(path))
    assert.equal(await readFile(join(root,path),"utf8"),content,"Protected supplied assertions changed");
}
const wire=JSON.parse(gunzipSync(await readFile(join(study,"wire-contracts.json.gz"))));
const contracts=[];
for(const task of protocol.tasks)for(let rep=1;rep<=protocol.repetitions;rep++) {
  const rows=results.rows.filter(r=>r.id===task.id&&r.repetition===rep);
  const a=rows.find(r=>r.arm==="baseline"),b=rows.find(r=>r.arm==="modified");
  if(!a||!b)continue;
  assert.deepEqual(heads[a.name],heads[b.name]);
  const first=name=>wire.trials.find(t=>t.name===name)?.requests?.find(r=>!r.budgetRejected);
  const x=first(a.name),y=first(b.name);assert(x&&y);
  assert.equal(typeof x.toolsSha256,"string");
  assert.equal(x.toolsSha256,y.toolsSha256);
  assert.equal(x.normalizedContractSha256,y.normalizedContractSha256);
  contracts.push({id:task.id,repetition:rep,sameInitialGit:true,sameSchema:true,sameNormalizedContract:true});
}
const {writeFile,mkdir}=await import("node:fs/promises");
const {gzipSync}=await import("node:zlib");
const recovery=await json(join(campaign,"orchestration-recovery.json"));
const continuation=await json(join(campaign,"resume-manifest.json"));
const originalDriver=await readFile(join(repo,"tools/terminal_bench/navigation-evidence/run.mjs"),"utf8");
const administrativeDriver=await readFile(join(campaign,"resume-driver.mjs"),"utf8");
assert.equal(sha(originalDriver),continuation.originalDriverSha256);
assert.equal(sha(administrativeDriver),continuation.administrativeDriverSha256);
assert.equal(continuation.originalDriverSha256,bindings.inputs["tools/terminal_bench/navigation-evidence/run.mjs"]);
for(const name of continuation.unchangedFunctions){
 const pattern=new RegExp('async function '+name+'\\([^]*?(?=\\n(?:async )?function |\\nif \\(process\\.argv)');
 assert.equal(administrativeDriver.match(pattern)?.[0],originalDriver.match(pattern)?.[0],name);
}
const preservedRoot=join(campaign,recovery.affectedTrial);
for(const [path,expected]of Object.entries(recovery.originalFileSha256))
 assert.equal(sha(await readFile(join(preservedRoot,path==="workspace.diff.beforeScoring"?"workspace.diff":path))),expected,path);
const recovered=results.rows.find(r=>r.name===recovery.affectedTrial);
assert.equal(recovered.outerAgentMs,null);assert.equal(recovered.exit.code,null);
assert.equal(recovered.exit.orchestrationInterrupted,true);
assert.equal(recovered.durationMs,recovery.recordedWorkerDurationMs);
const order=results.provenance.order.map(t=>[t.repetition,t.id,t.arm].join("-"));
const oldLog=await readFile(join(work,"f27-run.log"),"utf8");
const newLog=await readFile(join(work,"f27-resume-run.log"),"utf8");
assert.equal(sha(oldLog),recovery.originalRunnerLogSha256);
const started=log=>[...log.matchAll(/^START (.+)$/gm)].map(m=>m[1]);
assert.deepEqual(started(oldLog),order.slice(0,24));
assert.deepEqual(started(newLog),order.slice(24,24+started(newLog).length));
for(const [name,bytes]of [["administrative-driver.mjs",Buffer.from(administrativeDriver)],["original-orchestration.log",Buffer.from(oldLog)],["continued-orchestration.log",Buffer.from(newLog)]])
 await writeFile(join(study,name+".gz"),gzipSync(bytes,{mtime:0}));
await writeFile(join(study,"resume-manifest.json"),JSON.stringify(continuation,null,2)+"\n");
await writeFile(join(study,"orchestration-recovery.json"),JSON.stringify(recovery,null,2)+"\n");
const {repairSearchSource}=await import("./native-search-repair.mjs");
const sdk=await import("node:fs/promises").then(fs=>fs.realpath(join(repo,"packages/agent-runtime/node_modules/@cline/sdk/package.json")));
const {dirname}=await import("node:path"),nativeBindings=await json(join(study,"native-search-bindings.json")),repairAudits=[];
for(const row of results.rows){
 const path=join(campaign,row.name,"native-search-loads.jsonl");let bytes;
 try{bytes=await readFile(path);}catch(error){if(error.code!=="ENOENT")throw error;}
 if(row.arm!=="cline"){assert.equal(bytes,undefined);continue;}
 assert(bytes,"Native trial lacks actual load audit: "+row.name);
 const records=bytes.toString().trim().split("\n").filter(Boolean).map(JSON.parse);
 assert(records.length>0);
 for(const record of records){
  assert.equal(record.originalSha256,nativeBindings.modules[record.module]);
  const source=await readFile(join(dirname(sdk),"../core/dist",record.module),"utf8");
  assert.equal(sha(source),record.originalSha256);assert.equal(sha(repairSearchSource(source).source),record.repairedSha256);
 }
 const artifact="native-search-loads/"+row.name+".jsonl.gz";await mkdir(join(study,"native-search-loads"),{recursive:true});
 await writeFile(join(study,artifact),gzipSync(bytes,{mtime:0}));repairAudits.push({name:row.name,artifact,bytes:bytes.length,sha256:sha(bytes),records});
}

const output={paidRequests:0,planned:results.planned,completed:results.completed,frozenInputHashesVerified:true,
  sourceIsolationVerified:true,protectedSuppliedAssertionsVerified:true,nativeRepairLoadsVerified:true,repairAudits,initialGitIdentities:heads,matchedLightContracts:contracts,
  administrativeContinuation:{verified:true,modelRetries:0,completedPrefix:24,remainingAssigned:12,newStarted:started(newLog).length,
    originalDriverSha256:sha(originalDriver),administrativeDriverSha256:sha(administrativeDriver),originalLogSha256:sha(oldLog),continuedLogSha256:sha(newLog),missingOuterMetadataRetained:true},
  method:"Original task Git identity, actual initial dispatch schema/workspace-normalized contract and frozen input SHA equality. Checks do not require favorable outcomes. Native repairs verified against actual original/repaired module hashes and absent from Light trials. Fresh and known strata remain separate."};
await writeFile(join(study,"native-evidence-checks.json"),JSON.stringify(output,null,2)+"\n");
console.log(JSON.stringify({...output,initialGitIdentities:undefined}));
