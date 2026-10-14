// Post-result sensitivity only. Never changes registered scores or model sources.
import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {createRequire} from "node:module";
import {repo,work,studyFor} from "./campaign-paths.mjs";
import {identifierTokens} from "../corpus/identifier-token-audit.mjs";
const ts=createRequire(join(repo,"packages/agent-runtime/package.json"))("typescript");
const study=studyFor("f26"),campaign=join(work,"f26"),json=async p=>JSON.parse(await readFile(p,"utf8"));
const protocol=await json(join(study,"protocol.json")),results=await json(join(study,"results.json"));
function stripOptionalPairFlag(text) {
  const source=ts.createSourceFile("source.ts",text,ts.ScriptTarget.Latest,true);
  const alias=source.statements.filter(n=>ts.isTypeAliasDeclaration(n)&&n.name.text==="ObjectPair");
  if(alias.length!==1||!ts.isTypeLiteralNode(alias[0].type))throw Error("Unexpected ObjectPair declaration");
  const flag=alias[0].type.members.filter(n=>n.name?.getText(source)==="alwaysSet");
  if(!flag.length)return text;
  if(flag.length!==1||!ts.isPropertySignature(flag[0])||!flag[0].questionToken||flag[0].type?.kind!==ts.SyntaxKind.BooleanKeyword)
    throw Error("Only an optional boolean merging flag is considered");
  return text.slice(0,flag[0].getStart(source))+text.slice(flag[0].end);
}
function masked(text,names) {
  const source=ts.createSourceFile("source.ts",text,ts.ScriptTarget.Latest,true),ranges=[];
  function visit(n) {
    const name=ts.isMethodDeclaration(n)&&ts.isClassDeclaration(n.parent)?n.parent.name?.text+"."+n.name.getText(source):null;
    if(n.body&&names.includes(name))ranges.push({name,start:n.getStart(source),end:n.end});
    ts.forEachChild(n,visit);
  }visit(source);
  for(const name of names)assert.equal(ranges.filter(r=>r.name===name).length,1);
  for(const r of ranges.sort((a,b)=>b.start-a.start))text=text.slice(0,r.start)+";"+text.slice(r.end);
  return JSON.stringify(identifierTokens(text));
}
assert.throws(()=>stripOptionalPairFlag('export type ObjectPair = { alwaysSet: boolean; };'));
assert.throws(()=>stripOptionalPairFlag('export type ObjectPair = { alwaysSet?: string; };'));
const rows=[];
for(const row of results.rows.filter(r=>r.id==="zod-record-own-presence")) {
  const task=protocol.tasks.find(t=>t.id===row.id),score=await json(join(campaign,row.name,"score.json"));
  const integrity=[];
  for(const path of task.allowedPaths) {
    const original=await readFile(join(repo,protocol.upstreams[task.project].sourceRoot,path),"utf8");
    let current=await readFile(join(campaign,row.name,"workspace",path),"utf8"),exception=null;
    try {
      if(path.endsWith("parseUtil.ts")) {const stripped=stripOptionalPairFlag(current);exception=stripped!==current?"Optional ObjectPair.alwaysSet:boolean only":null;current=stripped;}
      integrity.push({path,passed:masked(original,task.mutableFunctions[path])===masked(current,task.mutableFunctions[path]),exception});
    }catch(error){integrity.push({path,passed:false,error:error.message});}
  }
  const other=score.featureChecks.filter(c=>!c.name.includes("registered-source-integrity:"));
  const sourceBehaviorAndChecks=integrity.every(c=>c.passed)&&other.length>0&&other.every(c=>c.passed)&&
    [score.selected,score.types,score.full].every(c=>c.exitCode===0)&&score.unexpectedPaths.length===0;
  rows.push({name:row.name,arm:row.arm,repetition:row.repetition,originalRegisteredFunctional:row.independentFunctionalSuccess,
    originalRegisteredAudit:row.auditedCompletion,integrity,sourceBehaviorAndChecks,
    exploratoryAudited:sourceBehaviorAndChecks&&row.officialRuntimeSuccess&&row.agentRequiredChecksPassed&&row.noSolutionRetrieval&&row.fullRequestCriteriaPassed,
    eventsSha256:row.eventsSha256,diffSha256:row.diffSha256,scoreSha256:row.scoreSha256,usage:row.usage,durationMs:row.durationMs});
}
const comparisons=[];
for(const [left,right] of [["modified","baseline"],["modified","cline"]]) {
  const pairs=rows.filter(r=>r.arm===left&&r.exploratoryAudited&&r.usage.tokensCostReconciled).map(a=>[a,rows.find(b=>b.arm===right&&b.repetition===a.repetition&&b.exploratoryAudited&&b.usage.tokensCostReconciled)]).filter(p=>p[1]);
  const metrics={tokens:r=>r.usage.input+r.usage.output,estimatedUsd:r=>r.usage.cost,runnerSeconds:r=>r.durationMs/1000};
  comparisons.push({left,right,pairs:pairs.length,resources:Object.fromEntries(Object.entries(metrics).map(([key,value])=>{
    const a=pairs.reduce((n,p)=>n+value(p[0]),0),b=pairs.reduce((n,p)=>n+value(p[1]),0);return[key,{left:a,right:b,relativeChange:pairs.length&&b?a/b-1:null}];
  }))});
}
await writeFile(join(study,"criterion-sensitivity.json"),JSON.stringify({paidRequests:0,
  method:"Exploratory post-result source-mask sensitivity, not preregistered efficacy. Preserve original scores. The task prose limits implementation to record parsing/async pair merging, but does not explicitly forbid the auxiliary ObjectPair type. Consider exactly one optional boolean flag, protect every other token outside the registered methods, and require all behavior/protected assertions/typecheck/full-suite/actual-command/report criteria. Required or nonboolean flags are rejected by local controls. No source repair, retry or feedback.",rows,comparisons},null,2)+"\n");
console.log(JSON.stringify({primaryScoresUnchanged:true,rows:rows.map(({name,originalRegisteredFunctional,exploratoryAudited})=>({name,originalRegisteredFunctional,exploratoryAudited})),comparisons}));
