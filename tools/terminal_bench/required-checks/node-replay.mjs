// Same real Node output scored by immutable F15 and the new observer. No models.
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
const repo=resolve(new URL("../../..",import.meta.url).pathname);
const base=process.argv[2]??join(repo,".blame/research/required-validation/frozen/modified/agent-runtime/dist/harness/check-observation.js");
const candidate=join(repo,"packages/agent-runtime/dist/harness/check-observation.js");
const {workspaceCommandEnvironment}=await import(join(repo,"packages/agent-runtime/dist/harness/workspace-command-environment.js"));
const old=await import(base),now=await import(candidate);
const root=await mkdtemp(join(tmpdir(),"blame-node-replay-"));
const rows=[];
try{
  await writeFile(join(root,"suite.test.cjs"),"const {test}=require('node:test');test('alpha',()=>{});test('beta',()=>{});\n");
  await writeFile(join(root,"empty.test.cjs"),"// Empty worker.\n");
  await writeFile(join(root,"named.test.cjs"),"require('node:test').test('named.test.cjs',()=>{});\n");
  await writeFile(join(root,"fail.test.cjs"),"throw Error('setup failed');\n");
  for(const reporter of [[],["--test-reporter=tap"]]) for(const [name,args,actualCases] of [
    ["all-real",["suite.test.cjs"],2],
    ["filter-real",["--test-name-pattern=alpha","suite.test.cjs"],1],
    ["no-match",["--test-name-pattern=absent","suite.test.cjs"],0],
    ["empty",["empty.test.cjs"],0],
    ["mixed",["suite.test.cjs","empty.test.cjs"],2],
    ["legitimate-path-name",["named.test.cjs"],1],
    ["setup-failed",["fail.test.cjs"],0],
  ]){
    const argv=["--test",...reporter,...args];
    const result=spawnSync(process.execPath,argv,{cwd:root,encoding:"utf8",timeout:5000,env:workspaceCommandEnvironment(process.env,process.execPath)});
    if(result.error)throw result.error;
    const raw={all:result.stdout+result.stderr,exitCode:result.status,failed:result.status!==0};
    const command="node "+argv.join(" ");
    rows.push({name,reporter:reporter.length?"tap":"default",command,actualRegisteredCases:actualCases,raw,
      reference:old.observeCheck(command,raw,".",false),candidate:now.observeCheck(command,raw,".",false)});
  }
}finally{await rm(root,{recursive:true,force:true});}
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const result={method:"Known local diagnostics, not held-out task success. Same captured invocation for both observers; case counts derive from controlled fixture registrations. Path-named genuine cases explicitly retain their adverse loss of confirmation. Unknown is not zero. F15 model snapshots remain unchanged and do not include this F16 guard.",node:process.version,reference:{module:base,sha256:sha(await readFile(base))},candidate:{module:candidate,sha256:sha(await readFile(candidate))},rows};
await writeFile(join(repo,".blame/research/required-validation/node-observation-replay.json"),JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({invocations:rows.length,withheldCounts:rows.filter(r=>r.reference.counts&&!r.candidate.counts).length,
  adverseLegitimateCases:rows.filter(r=>r.name==="legitimate-path-name"&&r.candidate.execution!=="observed").length}));
