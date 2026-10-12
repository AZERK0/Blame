import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {createHash} from "node:crypto";
const repo=resolve(new URL("../../..",import.meta.url).pathname);
const {LightWorkspace}=await import(join(repo,"packages/agent-runtime/dist/harness/light-workspace.js"));
const tasks=[
 ["date-fns","src/format/index.ts","format"], ["date-fns","src/parse/index.ts","parse"],
 ["date-fns","src/_lib/addLeadingZeros/index.ts","addLeadingZeros"],
 ["date-fns","src/types.ts","ContextOptions"],
 ["lodash","lodash.js","baseClamp"],["lodash","lodash.js","baseToNumber"],
];
const roots={"date-fns":join(repo,".blame/research/npm-formatter-confirmation/date-fns"),lodash:join(repo,".blame/research/scope-followup/upstreams/lodash")};
const rows=[];
for(const [project,path,name] of tasks){
 const root=await mkdtemp(join(tmpdir(),"blame-signature-replay-"));try{
  const content=await readFile(join(roots[project],path));const local=path.endsWith(".ts")?"source.ts":"source.js";await writeFile(join(root,local),content);
  const pair={};for(const view of ["symbol","signature"]){const workspace=new LightWorkspace(root,{sessionId:view});
   const search=await workspace.searchCode({query:name,mode:"symbol"});if(search.status!=="ok")throw Error(JSON.stringify(search));
   const target=search.data.results.find(t=>t.qualifiedName.split(".").at(-1)===name);if(!target)throw Error("Target absent");
   const result=await workspace.readCode({target:target.alias,view},{});if(result.status!=="ok")throw Error(JSON.stringify(result));pair[view]={bytes:Buffer.byteLength(JSON.stringify(result)),result};}
  rows.push({project,path,name,sourceSha256:createHash("sha256").update(content).digest("hex"),...pair});
 }finally{await rm(root,{recursive:true,force:true});}
}
const output={method:"Known local real-source projections. Signature omits implementation/type members by explicit request, so smaller response is not equivalent behavioral information or measured billed token saving. Separate fresh observation consumers; unchanged source; no model outcomes.",rows,totalBytes:Object.fromEntries(["symbol","signature"].map(k=>[k,rows.reduce((n,r)=>n+r[k].bytes,0)]))};
await writeFile(join(repo,"docs/experiments/light-harness-navigation-evidence-local-2026-10-13/f19-read-replay.json"),JSON.stringify(output,null,2)+"\n");console.log(JSON.stringify(output.totalBytes));
