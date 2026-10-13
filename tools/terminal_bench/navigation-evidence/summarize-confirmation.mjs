// Summarize separately audited panels without pooling different ablations.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { repo, studyFor } from "./campaign-paths.mjs";
assert.equal(process.env.BLAME_STUDY_VARIANT,"confirm2");
const root=join(repo,"docs/experiments/light-harness-mechanism-confirmation-2026-10-13");
const json=async path=>JSON.parse(await readFile(path,"utf8"));
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const original=await json(join(root,"protocol.json"));
const panels=[], allRows=[], runtimeHashes=new Set();
for(const panel of original.panelOrder){
 const study=studyFor(panel),bytes=await readFile(join(study,"results.json"));
 const result=JSON.parse(bytes),bindings=await json(join(study,"execution-bindings.json"));
 const protocol=await json(join(study,"protocol.json"));
 const mechanisms=await json(join(study,"mechanism-analysis.json"));
 const wire=await json(join(study,"wire-inventory.json"));
 const comparison=await json(join(study,"paired-comparison.json"));
 assert.equal(protocol.repetitions,2);assert.equal(protocol.tasks.length,2);
 assert.equal(protocol.clineRuntimeArm,"modified");
 assert.equal(protocol.budgets.sharedStudyObservedCostStopUsd,.5);
 runtimeHashes.add(bindings.versions.modified.runtime);
 panels.push({panel,resultsSha256:sha(bytes),protocolSha256:sha(await readFile(join(study,"protocol.json"))),
   planned:result.planned,completed:result.completed,unexecuted:result.planned-result.completed,
   arms:Object.fromEntries(["baseline","modified","cline"].map(arm=>{
    const rows=result.rows.filter(r=>r.arm===arm),m=mechanisms.rows.filter(r=>r.name.endsWith("-"+arm));
    return [arm,{trials:rows.length,planned:result.provenance.order.filter(t=>t.arm===arm).length,
      official:rows.filter(r=>r.officialRuntimeSuccess).length,functional:rows.filter(r=>r.independentFunctionalSuccess).length,
      actualRequiredChecks:rows.filter(r=>r.agentRequiredChecksPassed).length,
      fullCriteria:rows.filter(r=>r.fullRequestCriteriaPassed).length,audited:rows.filter(r=>r.auditedCompletion).length,
      signatureRequests:m.reduce((n,r)=>n+r.signatureRequests,0),boundedRecoveryHints:m.reduce((n,r)=>n+r.boundedRecoveryHints,0),
      activeCaseCaptions:m.reduce((n,r)=>n+r.activeCaseCaptions,0)}];})),
   wire, comparisons:comparison.comparisons.filter(c=>c.partition==="all")});
 for(const row of result.rows)allRows.push({panel,...row});
}
assert.equal(runtimeHashes.size,1,"Full candidate runtime must be identical across all panels");
const summary={method:"Fresh constructed tasks on reused real repositories; two repetitions, three serial arms. Baseline versions remove different features and are never pooled for efficacy. Panel resource comparisons require independently audited/accounting-matched both-success pairs. Aggregate phase success describes this fixed task mix, not external population or global improvement. F22 nominal output8192 is unsupported on actual OAuth; F21/F23 share the preregistered operational byte-budget amendment.",
 originalProtocolSha256:sha(await readFile(join(root,"protocol.json"))),
 amendedProtocolSha256:sha(await readFile(join(root,"protocol-v2.json"))),
 panels,planned:panels.reduce((n,p)=>n+p.planned,0),completed:allRows.length,
 unexecuted:panels.reduce((n,p)=>n+p.unexecuted,0),
 currentRuntimeSha256:[...runtimeHashes][0],
 currentVsClineAssignedSuccess:Object.fromEntries(["modified","cline"].map(arm=>[arm,{
   planned:panels.reduce((n,p)=>n+p.arms[arm].planned,0),attempted:allRows.filter(r=>r.arm===arm).length,
   official:allRows.filter(r=>r.arm===arm&&r.officialRuntimeSuccess).length,
   functional:allRows.filter(r=>r.arm===arm&&r.independentFunctionalSuccess).length,
   audited:allRows.filter(r=>r.arm===arm&&r.auditedCompletion).length}])),
 observedEstimatedUsd:allRows.reduce((n,r)=>n+(r.usage.cost??0),0),
 unknownCostAggregates:allRows.filter(r=>r.usage.cost===null).length,
 missingUsageReserveUsd:allRows.filter(r=>r.usage.cost===null).length*.27,
 estimatedPhaseCeilingUsd:.5, invoiceVerified:false,
 timeouts:allRows.filter(r=>r.status==="timed_out").length,
 watchdogs:allRows.filter(r=>r.exit.watchdog).length,
 tokenCostReconciled:allRows.filter(r=>r.usage.tokensCostReconciled).length,
 fullRequestCacheAccounting:allRows.filter(r=>r.usage.complete).length,
 maximumObservedRequestOutputTokens:Math.max(...allRows.flatMap(r=>r.usage.perRequest).filter(r=>r.output!==null).map(r=>r.output)),
 actualWireRequestAttempts:panels.reduce((n,p)=>n+p.wire.requests,0),
 wireOutputLimitPresent:panels.reduce((n,p)=>n+p.wire.wireOutputLimitPresent,0),
 byteBudgetRejections:panels.reduce((n,p)=>n+p.wire.budgetRejected,0),
 limitations:"Unblinded recorded-action/source audits, reused repositories, internally constructed tasks, only two task clusters per mechanism, no provider revision/seed/invoice/hidden retry guarantees, full request-cache accounting unavailable. Structured test evidence, admitted verification, official completion and full user acceptance remain distinct."};
await writeFile(join(root,"phase-summary.json"),JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify({planned:summary.planned,completed:summary.completed,estimatedUsd:summary.observedEstimatedUsd,
 success:summary.currentVsClineAssignedSuccess,wireOutputLimitPresent:summary.wireOutputLimitPresent}));
