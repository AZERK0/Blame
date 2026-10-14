import assert from "node:assert/strict";
import {mkdir,readFile,writeFile,realpath} from "node:fs/promises";
import {join,dirname} from "node:path";
import {pathToFileURL} from "node:url";
import {execFileSync} from "node:child_process";
import {repo,work,studyFor} from "./campaign-paths.mjs";
import {stripPermittedMembers} from "./source-integrity.mjs";
import {identifierTokens} from "../corpus/identifier-token-audit.mjs";
const study=studyFor("f27");
if(process.argv[2]==="worker") {
  const root=process.argv[3],sdk=await realpath(join(repo,"packages/agent-runtime/node_modules/@cline/sdk/package.json"));
  const {createDefaultExecutors}=await import(pathToFileURL(await realpath(join(dirname(sdk),"../core/dist/index.js"))));
  const search=createDefaultExecutors({search:{maxResults:100,contextLines:2}}).search;
  const output=await search("needle",root,{signal:new AbortController().signal});
  const headers=[...output.matchAll(/^([^\n]+\.ts):(\d+):(\d+)$/gmu)];let file=null;const mismatches=[];
  for(const line of output.split("\n")){
    const header=/^([^\n]+\.ts):(\d+):(\d+)$/u.exec(line);if(header){file=header[1];continue;}
    const context=/^[ >] (\d+): (.*)$/u.exec(line);if(!context||!file)continue;
    const actual=(await readFile(join(root,file),"utf8")).split("\n")[Number(context[1])-1];
    if(context[2].trimEnd()!==actual)mismatches.push({file,line:Number(context[1]),presented:context[2],actual});
  }
  const bounded=await createDefaultExecutors({search:{maxResults:2,contextLines:2}}).search("needle",root,{});
  const empty=await search("absentneedleword",root,{});
  const controller=new AbortController();controller.abort();let aborted=false;
  try{await search("needle",root,{signal:controller.signal});}catch{aborted=true;}
  process.stdout.write(JSON.stringify({output,headers:headers.map(h=>({file:h[1],line:Number(h[2])})),mismatches,matchingLineText:output.split("\n").filter(l=>l.startsWith("> ")).length,
    boundedHeaders:[...bounded.matchAll(/^([^\n]+\.ts):(\d+):(\d+)$/gmu)].length,empty,aborted}),()=>process.exit(0));
} else {
  const root=join(work,"native-search-controls");await mkdir(root,{recursive:true});
  await writeFile(join(root,"a.ts"),'const beforeA=1;\nconst needle=1;\nconst afterA=1;\nconst near=needle;\n// gap\n// gap\n// gap\nconst late=needle;\n');
  await writeFile(join(root,"b.ts"),'const beforeB="other file";\nconst needle=2;\nconst afterB=2;\n');
  execFileSync("git",["init","--quiet"],{cwd:root});
  const results={};
  for(const arm of ["legacy","repaired"]) {
    const args=arm==="repaired"?["--import",join(repo,"tools/terminal_bench/navigation-evidence/native-search-repair.mjs")]:[];
    const env={...process.env,...(arm==="repaired"?{BLAME_STUDY_NATIVE_SEARCH_BINDINGS:join(study,"native-search-bindings.json"),BLAME_STUDY_NATIVE_SEARCH_AUDIT:join(root,"repair-loads.jsonl")}: {})};
    results[arm]=JSON.parse(execFileSync(process.execPath,[...args,new URL(import.meta.url).pathname,"worker",root],{env,encoding:"utf8",timeout:30000,maxBuffer:1024*1024}));
  }
  assert.equal(results.legacy.headers.length,3);assert(results.legacy.mismatches.length>0);
  assert.equal(results.repaired.headers.length,4);assert.equal(results.repaired.mismatches.length,0);
  assert.equal(results.repaired.matchingLineText,4);assert.equal(results.repaired.boundedHeaders,2);
  assert(results.repaired.empty.startsWith("No results found"));assert(results.repaired.aborted);
  const permissions={ObjectPair:{alwaysSet:"boolean"}},base='export type ObjectPair={key:number;value:number;};';
  const candidates=[base,base.replace('value:number;','value:number;alwaysSet?:boolean;')];
  for(const candidate of candidates)assert.deepEqual(identifierTokens(stripPermittedMembers(candidate,permissions)),identifierTokens(base));
  for(const field of ['alwaysSet:boolean;','alwaysSet?:string;'])assert.throws(()=>stripPermittedMembers(base.replace('value:number;',`value:number;${field}`),permissions));
  assert.notDeepEqual(identifierTokens(stripPermittedMembers(base.replace('value:number;','value:string;alwaysSet?:boolean;'),permissions)),identifierTokens(base));
  await writeFile(join(study,"native-repair-controls.json"),JSON.stringify({paidRequests:0,results,auxiliaryControls:{validVariants:2,invalidTypesRejected:2,unrelatedChangeRejected:true},
    loadAudit:(await readFile(join(root,"repair-loads.jsonl"),"utf8")).trim().split("\n").map(JSON.parse),
    method:"Actual unchanged SDK and isolated load-time repair; exhaustive later-file and spaced matching lines, matched-line display, source-bound contexts, global result bound, empty and pre-aborted search. Old source criterion unchanged unless a new task explicitly opts into optional members. No model call or installed dependency edit."},null,2)+"\n");
  console.log(JSON.stringify({paidRequests:0,legacyMatches:3,repairedMatches:4,repairedContextMismatches:0,auxiliaryVariants:2}));
}
