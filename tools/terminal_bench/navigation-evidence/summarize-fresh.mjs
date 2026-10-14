// Descriptive analysis only; audited decisions are separately recorded after inspection.
import {readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {repo,work,studyFor} from "./campaign-paths.mjs";
import {reserveTrialCosts} from "./budget-accounting.mjs";
const study=studyFor("f26"),campaign=join(work,"f26");
const json=async p=>JSON.parse(await readFile(p,"utf8"));
const results=await json(join(study,"results.json")),protocol=await json(join(study,"protocol.json"));
const ledger=await json(join(campaign,"tool-ledger.json")),wireByTrial={},mechanisms=[];
for(const row of results.rows) {
  const tools=ledger.find(t=>t.name===row.name).tools;
  const events=(await readFile(join(campaign,row.name,"events.jsonl"),"utf8")).trim().split("\n").filter(Boolean).map(s=>JSON.parse(s).event);
  const wire=(await readFile(join(campaign,row.name,"wire-contracts.jsonl"),"utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
  wireByTrial[row.name]=wire;
  const commands=tools.flatMap((t,index)=>t.tool==="run_task"?[{index,input:t.input,status:t.output?.status,command:t.output?.data?.command??t.input.command??null,exitCode:t.output?.data?.exitCode??null,check:t.output?.data?.check??null,output:t.output}]:t.tool==="run_commands"?
    (Array.isArray(t.input.commands)?t.input.commands:typeof t.input.commands==="string"?[t.input.commands]:[]).map(command=>({index,command,output:t.output})):[]);
  const lastEditIndex=tools.reduce((last,t,i)=>["edit_code","apply_patch"].includes(t.tool)?i:last,-1);
  const finalReport=[...tools].reverse().find(t=>t.tool==="finish_task")?.input.summary??[...events].reverse().find(e=>e.type==="done")?.payload?.text??null;
  mechanisms.push({name:row.name,id:row.id,arm:row.arm,repetition:row.repetition,eventsSha256:row.eventsSha256,
    compilerReferenceCalls:row.semanticReferenceCalls,compilerRenameCalls:row.semanticRenameCalls,
    disabledRenameCalls:tools.filter(t=>t.tool==="edit_code"&&t.output?.message?.includes("Compiler rename is disabled")).length,
    blockedEdits:tools.filter(t=>t.tool==="edit_code"&&t.output?.status==="blocked").length,
    searchInputs:tools.filter(t=>["search_code","search_codebase"].includes(t.tool)).map(t=>t.input),
    editCalls:tools.filter(t=>["edit_code","apply_patch"].includes(t.tool)).map(t=>({input:t.input,status:t.output?.status,message:t.output?.message})),
    readCalls:tools.filter(t=>["read_code","read_files"].includes(t.tool)).length,
    readBytes:tools.filter(t=>["read_code","read_files"].includes(t.tool)).reduce((n,t)=>n+Buffer.byteLength(JSON.stringify(t.output)??""),0),
    commands,lastEditIndex,finalReport,verification:row.completion?.verification??null,
    dispatchedRequests:wire.filter(r=>!r.budgetRejected).length,byteRejected:wire.filter(r=>r.budgetRejected).length,
    missingWireResponseUsage:Math.max(0,wire.filter(r=>!r.budgetRejected).length-row.usage.perRequest.length),
    actualOutputLimits:[...new Set(wire.filter(r=>!r.budgetRejected).map(r=>r.maximumOutputTokens))]});
}
const fields=rows=>({trials:rows.length,official:rows.filter(r=>r.officialRuntimeSuccess).length,functional:rows.filter(r=>r.independentFunctionalSuccess).length,
  actualChecks:rows.filter(r=>r.agentRequiredChecksPassed).length,strict:rows.filter(r=>r.auditedCompletion).length,
  tokensObserved:rows.reduce((n,r)=>n+(r.usage.input??0)+(r.usage.output??0),0),estimatedUsdObserved:rows.reduce((n,r)=>n+(r.usage.cost??0),0),
  runnerSecondsObserved:rows.reduce((n,r)=>n+(r.durationMs??0),0)/1000,fullCacheAccounting:rows.filter(r=>r.usage.complete).length,
  tokenCostReconciled:rows.filter(r=>r.usage.tokensCostReconciled).length,timeouts:rows.filter(r=>r.status==="timed_out").length,failed:rows.filter(r=>r.status==="failed").length,
  missingConsumption:rows.filter(r=>r.usage.input===null||r.usage.output===null||r.usage.cost===null).length});
function compare(left,right,tier) {
  const accept=r=>r.officialRuntimeSuccess&&r.independentFunctionalSuccess&&r.agentRequiredChecksPassed&&r.noSolutionRetrieval&&r.usage.tokensCostReconciled&&(tier==="functional"||r.auditedCompletion);
  const pairs=results.rows.filter(r=>r.arm===left&&accept(r)).map(a=>[a,results.rows.find(b=>b.arm===right&&b.id===a.id&&b.repetition===a.repetition&&accept(b))]).filter(p=>p[1]);
  const get={tokens:r=>r.usage.input+r.usage.output,cost:r=>r.usage.cost,seconds:r=>r.durationMs/1000};
  const resource=subset=>Object.fromEntries(Object.entries(get).map(([name,value])=>{
    const a=subset.reduce((n,p)=>n+value(p[0]),0),b=subset.reduce((n,p)=>n+value(p[1]),0);
    return [name,{left:a,right:b,relativeChange:subset.length&&b?a/b-1:null}];
  }));
  return {left,right,tier,pairs:pairs.length,resources:resource(pairs),tasks:protocol.tasks.map(t=>({id:t.id,pairs:pairs.filter(([a])=>a.id===t.id).length,resources:resource(pairs.filter(([a])=>a.id===t.id))})),
    individual:pairs.map(pair=>({id:pair[0].id,repetition:pair[0].repetition,resources:resource([pair])}))};
}
const accounting=reserveTrialCosts(results.rows,wireByTrial,protocol.budgets),prior=await json(join(campaign,"shared-budget-accounting.json"));
const summary={method:"Fresh second-project confirmation on two selected Zod tasks, three assigned repetitions. Availability plus recovery-friction ablation; behavioral task is a non-rename control. All assignments retained. Strict audited and functional source/actual-check quality are separate. Source repairs, paid retry, solution retrieval and feedback are prohibited. Financial aggregation never pools efficacy.",
  planned:results.planned,completed:results.completed,unexecuted:results.planned-results.completed,
  arms:Object.fromEntries(protocol.arms.map(a=>[a,{planned:results.provenance.order.filter(r=>r.arm===a).length,...fields(results.rows.filter(r=>r.arm===a))}])),
  comparisons:["strict","functional"].flatMap(t=>[["modified","baseline"],["modified","cline"],["baseline","cline"]].map(([a,b])=>compare(a,b,t))),
  accounting,priorAccountedUsd:prior.priorObservedCost,totalAccountedUsd:prior.priorObservedCost+accounting.accountedUsd,
  referenceEquivalentEur:(prior.priorObservedCost+accounting.accountedUsd)/protocol.budgetAmendment.referenceFx.usdPerEur,
  limits:{authorizedEur:1,operationalUsd:protocol.budgets.sharedStudyObservedCostStopUsd,invoiceVerified:false},
  newMissingWireResponseUsage:mechanisms.reduce((n,r)=>n+r.missingWireResponseUsage,0),
  limitations:"Only two fresh task clusters; incomplete repetitions do not establish a robust general advantage. Zod has 84 upstream source/test TS files and one large module, not a large-repository population. Same schema advertises disabled rename, so this includes recovery friction. Provider seed/revision, invoices, hidden retries and complete cache fields unavailable. Correct code without honest final reports or actual requested checks is not strict audited success. Missing admission remains unknown."};
if(summary.totalAccountedUsd>protocol.budgets.sharedStudyObservedCostStopUsd)throw Error("Financial ceiling exceeded");
await writeFile(join(study,"fresh-summary.json"),JSON.stringify(summary,null,2)+"\n");
await writeFile(join(study,"fresh-mechanisms.json"),JSON.stringify({rows:mechanisms},null,2)+"\n");
const header=["repetition","task","arm","state","official","functional","actualChecks","strictAudited","tokens","estimatedUsd","runnerSeconds"];
const lines=results.provenance.order.map(t=>{
  const r=results.rows.find(r=>r.id===t.id&&r.arm===t.arm&&r.repetition===t.repetition);
  return [t.repetition,t.id,t.arm,r?r.status:"unexecuted",r?.officialRuntimeSuccess??null,r?.independentFunctionalSuccess??null,r?.agentRequiredChecksPassed??null,r?.auditedCompletion??null,
    r&&r.usage.input!==null&&r.usage.output!==null?r.usage.input+r.usage.output:null,r?.usage.cost??null,r?.durationMs==null?null:r.durationMs/1000].map(v=>v===null?"":String(v)).join(",");
});
await writeFile(join(study,"trials.csv"),[header.join(","),...lines].join("\n")+"\n");
console.log(JSON.stringify({...summary,comparisons:summary.comparisons.map(({tasks,individual,...rest})=>rest),accounting:undefined}));
