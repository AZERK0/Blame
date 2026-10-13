// Descriptive extraction only. Never changes primary trial scores or raw bytes.
import {readFile,writeFile,readdir,mkdir} from "node:fs/promises";
import {join,resolve} from "node:path";
import {createHash} from "node:crypto";
import {gzipSync} from "node:zlib";
import {work,studyFor} from "./campaign-paths.mjs";
const panel=process.argv[2],study=studyFor(panel),campaign=join(work,panel);
const json=async p=>JSON.parse(await readFile(p,"utf8")),sha=b=>createHash("sha256").update(b).digest("hex");
const results=await json(join(study,"results.json")),ledger=await json(join(campaign,"tool-ledger.json"));
const protocol=await json(join(study,"protocol.json"));
const write=(name,value)=>writeFile(join(study,name),JSON.stringify(value,null,2)+"\n");
const mechanisms=[],reports=[],expectedReports=[];
for(const row of results.rows){
 const tools=ledger.find(t=>t.name===row.name).tools;
 const hints=tools.filter(t=>t.tool==="edit_code"&&t.output?.recovery?.includes('"nextRead"'));
 const signatures=tools.filter(t=>t.tool==="read_code"&&t.input.view==="signature");
 const checks=tools.filter(t=>t.tool==="run_task"&&t.output?.data?.check).map(t=>({input:t.input,command:t.output.data.command,check:t.output.data.check}));
 mechanisms.push({name:row.name,eventsSha256:row.eventsSha256,blockedEdits:tools.filter(t=>t.tool==="edit_code"&&t.output?.status==="blocked").length,
  boundedRecoveryHints:hints.length,signatureRequests:signatures.length,signatureRendered:signatures.filter(t=>t.output?.data?.view==="signature").length,
  activeCaseCaptions:tools.filter(t=>t.tool==="run_task"&&String(t.output?.data?.output??"").includes("Active Node case results:")).length,
  observedReadBytes:tools.filter(t=>t.tool==="read_code").reduce((n,t)=>n+Buffer.byteLength(JSON.stringify(t.output)),0),
  checkInvocations:checks,structuredNodeInvocations:checks.filter(t=>t.check.evidenceOrigin==="node_events").length,
  completionAsReported:row.completion,actualModelRequests:row.metrics?.context?.modelRequests??null,driverIterationStartCount:row.usage.requests,
  taskSuccess:row.auditedCompletion,resourceAccountingReconciled:row.usage.tokensCostReconciled});
 for(const check of checks)if(check.check.evidenceOrigin==="node_events")expectedReports.push({name:row.name,sha256:check.check.evidence.reportSha256});
 const root=join(campaign,row.name,"workspace/.blame/harness/test-results");
 try{for(const dir of await readdir(root)){
  const path=join(root,dir,"events.jsonl");let bytes;try{bytes=await readFile(path);}catch(error){if(error.code==="ENOENT")continue;throw error;}
  const artifact="node-reports/"+row.name+"."+dir+".jsonl.gz";await mkdir(join(study,"node-reports"),{recursive:true});await writeFile(join(study,artifact),gzipSync(bytes,{mtime:0}));
  reports.push({name:row.name,artifact,bytes:bytes.length,sha256:sha(bytes)});
 }}catch(error){if(error.code!=="ENOENT")throw error;}
}
await write("mechanism-analysis.json",{method:protocol.continuationOf
 ?"Administrative single-slot continuation of F25. Keep the parent11/12 and tail1/1 separate. Frozen runtime/schema/per-invocation budgets match, but actual prompt Git HEAD differs; the tail is exploratory. See continuation-summary.json and the unchanged tool-ledger for detailed inputs/results."
 :protocol.studyKind==="compiler-rename-ablation"
 ?"F25 single-action availability ablation, known diagnostics: baseline blocks compiler rename; modified retains current production. All other mechanisms, prompts and schemas are identical. Detailed recorded edits, commands and final reports are in rename-ablation-mechanisms.json; reporting tiers and financial accounting stay separate."
 :protocol.studyKind==="declaration-navigation"
 ?"Every finished input/result is SHA-bound to raw events. F24 changes only bounded exact declaration ranking; compiler references/rename, tool schemas, prompts, signatures and validation are common to both Light arms. Detailed search adoption, commands and final reports are in multifile-mechanisms.json. A changed route with identical replayed observations identifies no ranking efficacy. Preserve final-source validation and strict report criteria separately."
 :protocol.studyKind==="mechanism-confirmation"
 ?"Every finished effective input/result, SHA-bound to raw events. F21 removes only bounded recovery, F22 only signature availability, F23 only appended active-case captions. Both F23 arms retain identical structured evidence. Natural non-activation is retained and proves no efficacy. F23 accurate final active-case counts are an explicit registered criterion, separate from functional source success. Invocation proof alone admits no test scope."
 :"Every finished effective input/result, SHA-bound to raw events. Recovery activated in F19 is common to both arms and is not a signature effect. Requested and rendered signatures are distinct. Node counts are invocation proof, not scope or user acceptance. Model verbal count sensitivity stays separate from registered task scores.",rows:mechanisms});
await write("node-report-inventory.json",{method:"Exact invocation-sidechannel bytes; expected hashes come from unchanged model tool outputs. Missing overwritten/interrupted reports remain missing.",reports,missingExpectedReports:expectedReports.filter(e=>!reports.some(r=>r.name===e.name&&r.sha256===e.sha256))});
const fields=rows=>({trials:rows.length,tokenCostReconciled:rows.filter(r=>r.usage.tokensCostReconciled).length,
 inputTokensObserved:rows.reduce((n,r)=>n+(r.usage.input??0),0),outputTokensObserved:rows.reduce((n,r)=>n+(r.usage.output??0),0),
 missingTokenAggregates:rows.filter(r=>r.usage.input===null||r.usage.output===null).length,
 estimatedUsdObserved:rows.reduce((n,r)=>n+(r.usage.cost??0),0),missingCostAggregates:rows.filter(r=>r.usage.cost===null).length,
 runnerSecondsObserved:rows.reduce((n,r)=>n+(r.durationMs??0),0)/1000,missingDurations:rows.filter(r=>r.durationMs===null).length,
 fullRequestCacheAccounting:rows.filter(r=>r.usage.complete).length});
const comparisons=[];
for(const [a,b] of [["modified","baseline"],["modified","cline"],["baseline","cline"]]){
 const pairs=results.rows.filter(r=>r.arm===a&&r.auditedCompletion&&r.usage.tokensCostReconciled).map(r=>[r,results.rows.find(t=>t.arm===b&&t.id===r.id&&t.repetition===r.repetition&&t.auditedCompletion&&t.usage.tokensCostReconciled)]).filter(p=>p[1]);
 const left=fields(pairs.map(p=>p[0])),right=fields(pairs.map(p=>p[1]));const ratios={};
 for(const [key,read] of Object.entries({tokens:v=>v.inputTokensObserved+v.outputTokensObserved,cost:v=>v.estimatedUsdObserved,time:v=>v.runnerSecondsObserved}))ratios[key]=pairs.length&&read(right)?read(left)/read(right)-1:null;
 comparisons.push({arms:[a,b],matchedTasks:pairs.map(p=>p[0].id),left,right,relativeChange:ratios});
}
await write("resource-summary.json",{method:"SDK/API estimates, not invoices. Input includes cache subsets; output includes any reasoning subsets. Never add them twice. Missing consumption remains missing. All attempted totals and strict-success/accounting-matched comparisons are separate. An incomplete panel supports only descriptive observed pairs, not a complete-panel or population claim.",planned:results.planned,completed:results.completed,unexecuted:results.planned-results.completed,
 arms:Object.fromEntries(["baseline","modified","cline"].map(a=>[a,fields(results.rows.filter(r=>r.arm===a))])),comparisons});
console.log(JSON.stringify({panel,completed:results.completed,nodeReports:reports.length,missingExpectedReports:expectedReports.filter(e=>!reports.some(r=>r.name===e.name&&r.sha256===e.sha256)).length}));
