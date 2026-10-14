// Zero-model differential controls. Archived inputs/output are diagnostic data;
// miniatures below are not reruns or rescoring of the original model tasks.
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";

const [before, after, destination] = process.argv.slice(2);
if (!before || !after || !destination) throw Error("usage: node agent-guidance-controls.mjs BEFORE_DIST AFTER_DIST OUTPUT_DIRECTORY");
const repo = resolve(new URL("../../..", import.meta.url).pathname);
const archive = join(repo,"docs/experiments/light-harness-navigation-evidence-f27-2026-10-14-native2/tool-ledger.json");
const rawLedger = await readFile(archive);
const ledger = JSON.parse(rawLedger);
const sha = value => createHash("sha256").update(value).digest("hex");
const payload = result => result.status === "ok" ? result.data : result;
const summarize = result => ({...payload(result), renderedBytes:Buffer.byteLength(JSON.stringify(result))});
const moduleAt = (dist, file) => import(pathToFileURL(join(resolve(dist),"harness",file)));
const scopeInputs = ledger.filter(t=>t.name.endsWith("-modified")).flatMap(t=>t.tools.flatMap((tool,index)=>
  tool.tool==="search_code" && typeof tool.input.scope==="string" && tool.input.scope.includes(" ")
    ? [{trial:t.name,index,input:tool.input}] : []));
const source = "export function calculate(n: number) { return n + 1; }\n";
const common = {"original.ts":source,"consumer.ts":'import { calculate as compute } from "./original.js";\nexport { calculate as publicName } from "./original.js";\nexport const result = compute(1);\n',
  "package.json":'{"type":"module"}',"tsconfig.json":JSON.stringify({compilerOptions:{strict:true,noEmit:true,target:"ES2022",module:"NodeNext",moduleResolution:"NodeNext",types:[]},include:["*.ts"]})};
const variants=[];
for(const [label,dist]of [["before",before],["after",after]]) {
  const {LightWorkspace}=await moduleAt(dist,"light-workspace.js");
  const {observeCheck}=await moduleAt(dist,"check-observation.js");
  const {lightSemanticHarnessTools}=await moduleAt(dist,"light-tools.js");
  const {createFinishTaskTool}=await moduleAt(dist,"finish-task.js");
  async function fixture(files,run) {
    const root=await mkdtemp(join(tmpdir(),"blame-guidance-replay-"));
    try {
      for(const [path,text]of Object.entries(files)) {await mkdir(join(root,path,".."),{recursive:true});await writeFile(join(root,path),text);}
      return await run(new LightWorkspace(root,{sessionId:"guidance-replay"}),root);
    } finally {await rm(root,{recursive:true,force:true});}
  }
  const scopes=await fixture({
    "src/internal/util/isReadableStreamLike.ts":"export function readableStreamLikeToAsyncGenerator() {}\n",
    "src/internal/scheduled/scheduleAsyncIterable.ts":"export function scheduleAsyncIterable() {}\n",
    "src/internal/types.ts":"export interface ReadableStreamDefaultReaderLike {}\n",
    "spec/lifecycle.ts":"// spec\n",
  },async workspace=> {
    const rows=[];
    for(const item of scopeInputs) {
      const result=await workspace.searchCode(item.input),data=payload(result);
      const recovery=data.nextSearch ? payload(await workspace.searchCode(data.nextSearch)) : null;
      rows.push({...item,output:summarize(result),recoveryResultCount:recovery?.results?.length??null});
    }return rows;
  });
  const references=await fixture({...common,"homonym.ts":source},async workspace=>summarize(await workspace.searchCode({query:"calculate",mode:"references"})));
  const rename=await fixture(common,async(workspace,root)=> {
    await workspace.readCode({target:"original.ts#calculate"},{});
    const result=await workspace.editCode({operations:[{kind:"symbol",target:"original.ts#calculate",action:"rename",content:"updatedCalculation"}]});
    return {output:summarize(result),fileHashes:Object.fromEntries(await Promise.all(["original.ts","consumer.ts"].map(async path=>[path,sha(await readFile(join(root,path)))])))};
  });
  const reading=await fixture({"long.ts":"// padding\n".repeat(6500)+"export function tail() { return 7; }\n"},async workspace=> {
    const result=await workspace.readCode({target:"long.ts",view:"raw"},{}),data=payload(result);
    const unseenEdit=await workspace.editCode({operations:[{kind:"symbol",target:"long.ts#tail",action:"replace_body",content:"return 9;"}]});
    return {output:{...data,content:undefined,contentSha256:sha(data.content),contentBytes:Buffer.byteLength(data.content)},renderedBytes:Buffer.byteLength(JSON.stringify(result)),unseenEditStatus:unseenEdit.status};
  });
  const validation=ledger.filter(t=>t.name.endsWith("-modified")).flatMap(t=>t.tools.flatMap((tool,index)=> {
    const data=tool.output?.data,command=tool.input?.command;
    if(tool.tool!=="run_task" || !command?.includes("mocha") || !data?.output?.match(/\d+ passing/u) || typeof data.exitCode!=="number")return [];
    return [{trial:t.name,index,command,outputSha256:sha(data.output),
      observation:observeCheck(command,{all:data.output,exitCode:data.exitCode,failed:data.exitCode!==0},".",false)}];
  }));
  const patches=await fixture({"original.ts":source,"other.ts":source},async(workspace,root)=> {
    const symbol=payload(await workspace.readCode({target:"original.ts#calculate"},{}));
    const patch="*** Begin Patch\n"+["original.ts","other.ts"].map(path=>`*** Update File: ${path}\n@@\n-${source.trimEnd()}\n+${source.replace("n + 1","n + 2").trimEnd()}\n`).join("")+"*** End Patch";
    const result=await workspace.editCode({operations:[{kind:"patch",target:symbol.alias,patch}]});
    return {output:summarize(result),unchanged:(await readFile(join(root,"original.ts"),"utf8"))===source && (await readFile(join(root,"other.ts"),"utf8"))===source};
  });
  const descriptions=await fixture({},async(_,root)=>[...lightSemanticHarnessTools(root),createFinishTaskTool({workspaceRoot:root,conversationId:"guidance-replay"})].map(t=>({name:t.name,bytes:Buffer.byteLength(t.description)})));
  const prompt=await readFile(join(resolve(dist),"prompt/code-agent-system.txt"));
  const modules={};for(const file of ["light-workspace.js","light-navigation.js","light-reference-search.js","light-edit.js","light-semantic-rename.js","check-observation.js","light-task-runner.js","light-validation-report.js","light-finish-service.js","light-tools.js","light-completion.js","light-contracts.js"])
    modules[file]=await readFile(join(resolve(dist),"harness",file)).then(sha,error=>{if(error.code==="ENOENT")return null;throw error;});
  variants.push({label,node:process.version,runtimeHashes:modules,prompt:{bytes:prompt.length,sha256:sha(prompt)},descriptions,scopes,references,rename,reading,validation,patches});
}
await mkdir(resolve(destination),{recursive:true});
await writeFile(join(resolve(destination),"controls.json"),JSON.stringify({method:"Zero-model miniatures of six mechanisms plus exact archived scope inputs and Mocha output interpretation. No original task outcome is repaired/rescored; no model efficiency is measured.",ledgerSha256:sha(rawLedger),variants},null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify({output:join(resolve(destination),"controls.json"),variants:variants.length,scopeInputs:scopeInputs.length,mochaOutputs:variants[0].validation.length}));
