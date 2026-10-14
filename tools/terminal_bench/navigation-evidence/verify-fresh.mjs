// Integrity assertions independent of whether any arm wins or loses.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {gunzipSync} from "node:zlib";
import {repo,work,studyFor} from "./campaign-paths.mjs";
const study=studyFor("f26"),campaign=join(work,"f26"),json=async p=>JSON.parse(await readFile(p,"utf8"));
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
const {writeFile}=await import("node:fs/promises");
const output={paidRequests:0,planned:results.planned,completed:results.completed,frozenInputHashesVerified:true,
  sourceIsolationVerified:true,protectedSuppliedAssertionsVerified:true,initialGitIdentities:heads,matchedLightContracts:contracts,
  method:"Original task Git identity, actual initial dispatch schema/workspace-normalized contract and frozen input SHA equality. Checks do not require favorable outcomes. No administrative tail is retroactively pooled."};
await writeFile(join(study,"fresh-evidence-checks.json"),JSON.stringify(output,null,2)+"\n");
console.log(JSON.stringify({...output,initialGitIdentities:undefined}));
