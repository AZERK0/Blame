// Descriptive analysis only; audited decisions are separately recorded after inspection.
import {readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {repo,work,studyFor} from "./campaign-paths.mjs";
import {reserveTrialCosts} from "./budget-accounting.mjs";
const study=studyFor("f27"),campaign=join(work,"f27");
const json=async p=>JSON.parse(await readFile(p,"utf8"));
const results=await json(join(study,"results.json")),protocol=await json(join(study,"protocol.json"));
const ledger=await json(join(campaign,"tool-ledger.json")),wireByTrial={},wireUsageGapByTrial={},mechanisms=[],scoredEvidence={};
for(const row of results.rows) {
  const score=await json(join(campaign,row.name,"score.json"));
  const sourceScopeFailures=score.featureChecks.filter(c=>!c.passed&&/^(?:non-UTC:)?registered-source-integrity:/.test(c.name));
  const otherFeatures=score.featureChecks.filter(c=>!/^(?:non-UTC:)?registered-source-integrity:/.test(c.name));
  scoredEvidence[row.name]={requestedIndependentSuitesPassed:[score.selected,score.types,score.full].every(c=>c.exitCode===0),
    behaviorAndProtectedInputProbesPassed:otherFeatures.length>0&&otherFeatures.every(c=>c.passed),
    sourceScopeFailures:sourceScopeFailures.map(c=>c.name),allFeatureFailures:score.featureChecks.filter(c=>!c.passed).map(c=>c.name)};
  const tools=ledger.find(t=>t.name===row.name).tools;
  const events=(await readFile(join(campaign,row.name,"events.jsonl"),"utf8")).trim().split("\n").filter(Boolean).map(s=>JSON.parse(s).event);
  const wire=(await readFile(join(campaign,row.name,"wire-contracts.jsonl"),"utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
  wireByTrial[row.name]=wire;
  wireUsageGapByTrial[row.name]=Math.max(0,wire.filter(r=>!r.budgetRejected).length-row.usage.perRequest.length);
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
    actualOutputLimits:[...new Set(wire.filter(r=>!r.budgetRejected).map(r=>r.maximumOutputTokens))],
    partition:row.partition});
}
const fields=rows=>({trials:rows.length,official:rows.filter(r=>r.officialRuntimeSuccess).length,functional:rows.filter(r=>r.independentFunctionalSuccess).length,
  actualChecks:rows.filter(r=>r.agentRequiredChecksPassed).length,strict:rows.filter(r=>r.auditedCompletion).length,
  tokensObserved:rows.reduce((n,r)=>n+(r.usage.input??0)+(r.usage.output??0),0),estimatedUsdObserved:rows.reduce((n,r)=>n+(r.usage.cost??0),0),
  inputTokensObserved:rows.reduce((n,r)=>n+(r.usage.input??0),0),outputTokensObserved:rows.reduce((n,r)=>n+(r.usage.output??0),0),
  cacheReadTokensObserved:rows.reduce((n,r)=>n+(r.usage.cacheRead??0),0),cacheWriteTokensObserved:rows.reduce((n,r)=>n+(r.usage.cacheWrite??0),0),
  missingCacheReadAggregates:rows.filter(r=>r.usage.cacheRead==null).length,missingCacheWriteAggregates:rows.filter(r=>r.usage.cacheWrite==null).length,
  missingReasoningAggregates:rows.filter(r=>r.usage.reasoning==null).length,
  runnerSecondsObserved:rows.reduce((n,r)=>n+(r.durationMs??0),0)/1000,fullCacheAccounting:rows.filter(r=>r.usage.complete).length,
  tokenCostReconciled:rows.filter(r=>r.usage.tokensCostReconciled).length,timeouts:rows.filter(r=>r.status==="timed_out").length,failed:rows.filter(r=>r.status==="failed").length,
  missingResults:rows.filter(r=>r.status==="missing").length,outerWatchdogKills:rows.filter(r=>r.exit?.watchdog===true).length,
  missingWorkerDurations:rows.filter(r=>r.durationMs==null).length,
  missingWireUsageResponses:rows.reduce((n,r)=>n+wireUsageGapByTrial[r.name],0),wireMatchedTrialLedgers:rows.filter(r=>wireUsageGapByTrial[r.name]===0).length,
  orchestrationInterruptions:rows.filter(r=>r.exit?.orchestrationInterrupted).length,
  outerSecondsObserved:rows.reduce((n,r)=>n+(r.outerAgentMs??0),0)/1000,
  missingOuterDurations:rows.filter(r=>r.outerAgentMs==null).length,
  suitesAndBehaviorPassed:rows.filter(r=>scoredEvidence[r.name].requestedIndependentSuitesPassed&&scoredEvidence[r.name].behaviorAndProtectedInputProbesPassed).length,
  sourceScopeOnlyRejections:rows.filter(r=>scoredEvidence[r.name].sourceScopeFailures.length&&scoredEvidence[r.name].requestedIndependentSuitesPassed&&scoredEvidence[r.name].behaviorAndProtectedInputProbesPassed).length,
  missingConsumption:rows.filter(r=>r.usage.input===null||r.usage.output===null||r.usage.cost===null).length});
function compare(left,right,tier,partition,accountingTier="wire_matched") {
  const accept=r=>r.partition===partition&&r.officialRuntimeSuccess&&r.independentFunctionalSuccess&&r.agentRequiredChecksPassed&&r.noSolutionRetrieval&&r.usage.tokensCostReconciled&&(tier==="functional"||r.auditedCompletion)&&(accountingTier==="aggregate_only"||wireUsageGapByTrial[r.name]===0);
  const pairs=results.rows.filter(r=>r.arm===left&&accept(r)).map(a=>[a,results.rows.find(b=>b.arm===right&&b.id===a.id&&b.repetition===a.repetition&&accept(b))]).filter(p=>p[1]);
  const get={tokens:r=>r.usage.input+r.usage.output,cost:r=>r.usage.cost,seconds:r=>r.durationMs/1000};
  const resource=subset=>Object.fromEntries(Object.entries(get).map(([name,value])=>{
    const a=subset.reduce((n,p)=>n+value(p[0]),0),b=subset.reduce((n,p)=>n+value(p[1]),0);
    return [name,{left:a,right:b,relativeChange:subset.length&&b?a/b-1:null}];
  }));
  return {left,right,tier,partition,accountingTier,pairs:pairs.length,resources:resource(pairs),tasks:protocol.tasks.map(t=>({id:t.id,pairs:pairs.filter(([a])=>a.id===t.id).length,resources:resource(pairs.filter(([a])=>a.id===t.id))})),
    individual:pairs.map(pair=>({id:pair[0].id,repetition:pair[0].repetition,resources:resource([pair])}))};
}
const accounting=reserveTrialCosts(results.rows,wireByTrial,protocol.budgets),prior=await json(join(campaign,"shared-budget-accounting.json"));
const summary={method:"F27: preregistered fresh RxJS confirmation before separate known Zod diagnostics, three repetitions each. Only compiler-rename availability differs between Light arms; native SDK receives the isolated pinned search repair. Optional auxiliary members explicitly permitted by new task registrations. Preserve every assigned outcome. No repair,retry,solution recovery or feedback. Prior cohorts contribute finances only.",
  planned:results.planned,completed:results.completed,unexecuted:results.planned-results.completed,
  arms:Object.fromEntries(protocol.arms.map(a=>[a,{planned:results.provenance.order.filter(r=>r.arm===a).length,...fields(results.rows.filter(r=>r.arm===a))}])),
  strata:Object.fromEntries(protocol.phaseOrder.map(partition=>[partition,{arms:Object.fromEntries(protocol.arms.map(a=>[a,fields(results.rows.filter(r=>r.partition===partition&&r.arm===a))]))}])),
  tasks:protocol.tasks.map(task=>({id:task.id,partition:task.partition,arms:Object.fromEntries(protocol.arms.map(arm=>[arm,fields(results.rows.filter(r=>r.id===task.id&&r.arm===arm))]))})),
  adverseOutcomes:results.rows.filter(r=>!r.officialRuntimeSuccess||!r.independentFunctionalSuccess||!r.auditedCompletion||r.exit?.orchestrationInterrupted||wireUsageGapByTrial[r.name]).map(r=>({name:r.name,status:r.status,official:r.officialRuntimeSuccess,functional:r.independentFunctionalSuccess,audited:r.auditedCompletion,orchestrationInterrupted:r.exit?.orchestrationInterrupted??false,missingWireUsageResponses:wireUsageGapByTrial[r.name],...scoredEvidence[r.name]})),
  comparisons:protocol.phaseOrder.flatMap(partition=>["strict","functional"].flatMap(t=>[["modified","baseline"],["modified","cline"],["baseline","cline"]].map(([a,b])=>compare(a,b,t,partition)))),
  observedAggregateComparisons:protocol.phaseOrder.flatMap(partition=>["strict","functional"].flatMap(t=>[["modified","baseline"],["modified","cline"],["baseline","cline"]].map(([a,b])=>compare(a,b,t,partition,"aggregate_only")))),
  accountingComparisonRule:"Comparisons require zero observed wire/report gaps as well as reconciled token/cost aggregates. Earlier checkpoints used aggregate reconciliation alone; keep that sensitivity under observedAggregateComparisons, with gaps/reserves explicit. Exclusion for missing consumption is not evidence of better outcomes or complete-panel efficiency; all attempts and adverse partial subtotals remain visible. Cache accounting and provider invoices remain incomplete.",
  accounting,priorAccountedUsd:prior.priorObservedCost,totalAccountedUsd:prior.priorObservedCost+accounting.accountedUsd,
  referenceEquivalentEur:(prior.priorObservedCost+accounting.accountedUsd)/protocol.budgetAmendment.referenceFx.usdPerEur,
  limits:{authorizedEur:2,operationalUsd:protocol.budgets.sharedStudyObservedCostStopUsd,invoiceVerified:false},
  newMissingWireResponseUsage:mechanisms.reduce((n,r)=>n+r.missingWireResponseUsage,0),
  limitations:"Two fresh RxJS clusters,not a representative population; repeat trials are dependent within tasks. Known Zod diagnostics stay separate. No paid legacy SDK arm identifies model benefit from the search repair. Source-project tsconfig is supplied to all RxJS arms after a zero-model completeness block; no guard weakened. Per-task project Node version is pinned; actual model runtime Node24. Same advertised rename schema includes blocked recovery. One orchestration interruption after a recorded completed native result retains original events/result/source and missing outer metadata; administrative continuation skips the completed prefix under identical bindings/order/budgets. Worker durations exclude that unmeasured outer gap. Provider seeds/revision,invoices,hidden retries and full cache unknown. Actual checks,truthful reporting,formal admission and user criteria remain distinct."};
if(summary.totalAccountedUsd>protocol.budgets.sharedStudyObservedCostStopUsd)throw Error("Financial ceiling exceeded");
await writeFile(join(study,"native-summary.json"),JSON.stringify(summary,null,2)+"\n");
await writeFile(join(study,"native-mechanisms.json"),JSON.stringify({method:"Read-only trace and original-score extraction. Suites/behavior counters do not rescore source-scope failures or establish user completion.",rows:mechanisms,scoredEvidence},null,2)+"\n");
const header=["partition","repetition","task","arm","state","official","functional","actualChecks","strictAudited","tokens","estimatedUsd","runnerSeconds"];
const lines=results.provenance.order.map(t=>{
  const r=results.rows.find(r=>r.id===t.id&&r.arm===t.arm&&r.repetition===t.repetition);
  return [protocol.tasks.find(task=>task.id===t.id).partition,t.repetition,t.id,t.arm,r?r.status:"unexecuted",r?.officialRuntimeSuccess??null,r?.independentFunctionalSuccess??null,r?.agentRequiredChecksPassed??null,r?.auditedCompletion??null,
    r&&r.usage.input!==null&&r.usage.output!==null?r.usage.input+r.usage.output:null,r?.usage.cost??null,r?.durationMs==null?null:r.durationMs/1000].map(v=>v===null?"":String(v)).join(",");
});
await writeFile(join(study,"trials.csv"),[header.join(","),...lines].join("\n")+"\n");
console.log(JSON.stringify({...summary,comparisons:summary.comparisons.map(({tasks,individual,...rest})=>rest),accounting:undefined}));
