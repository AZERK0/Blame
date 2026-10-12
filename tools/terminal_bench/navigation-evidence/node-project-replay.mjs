// Actual supported project invocation on the same controlled final Lodash source.
import {readFile,writeFile,cp,symlink} from "node:fs/promises";
import {join,resolve} from "node:path";
const repo=resolve(new URL("../../..",import.meta.url).pathname),work=join(repo,".blame/research/navigation-evidence");
const root=join(work,"controls/f20/lodash-baseGt-comparison/workspace"),rows=[];
for(const [arm,module] of [
 ["reference",join(work,"f20-reference-source/packages/agent-runtime/dist/harness/light-workspace.js")],
 ["candidate",join(repo,"packages/agent-runtime/dist/harness/light-workspace.js")],
]){
 const target=join(work,"node-project-replay",arm,"workspace");
 await cp(root,target,{recursive:true,filter:path=>!path.split("/").slice(root.split("/").length).some(part=>part==="node_modules"||part===".blame")});
 await symlink(join(repo,".blame/research/scope-followup/lodash-dependencies/node_modules"),join(target,"node_modules"));
 const {LightWorkspace}=await import(module);const workspace=new LightWorkspace(target,{sessionId:arm});
 const result=await workspace.runTask({kind:"project",task:"test:study",args:["test/harness-regression.cjs","test/empty.node.cjs"]},{});
 if(result.status!=="ok"||result.data.exitCode!==0)throw Error(JSON.stringify(result));
 if(arm==="reference"&&result.data.check.execution!=="not_observed")throw Error("Expected conservative ambiguity");
 if(arm==="candidate"&&(result.data.check.counts?.executed!==3||result.data.check.evidenceOrigin!=="node_events"))throw Error("Structured cases absent");
 rows.push({arm,module,result});
}
await writeFile(join(repo,"docs/experiments/light-harness-navigation-evidence-local-2026-10-13/f20-node-project-replay.json"),JSON.stringify({method:"One known local real-Lodash invocation, on unchanged independent positive-control source and frozen npm-pinned task manifest. Both original three cases pass, while only candidate excludes the inert worker and confirms them. No model source repair or score rewriting.",rows},null,2)+"\n");console.log(JSON.stringify(rows.map(r=>({arm:r.arm,check:r.result.data.check.execution,count:r.result.data.check.counts?.executed??null}))));
