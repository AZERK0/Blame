// Independently recompute the primary reported comparison and retention gates.
import assert from 'node:assert/strict';
export function verifySummary(protocol,rows,summary){
 const treatment=protocol.arms.find(a=>!['reference','cline'].includes(a));
 const sum=(selected,get)=>selected.every(r=>get(r)!==null&&Number.isFinite(get(r)))?selected.reduce((n,r)=>n+get(r),0):null;
 const delta=(a,b)=>a===null||b===null||b===0?null:a/b-1;
 for(const arm of protocol.arms){
  const selected=rows.filter(r=>r.arm===arm),s=summary.arms[arm];
  for(const [field,predicate]of Object.entries({official:r=>r.officialRuntimeSuccess,independent:r=>r.independentFunctionalSuccess,
   audited:r=>r.auditedCompletion,sourceAudited:r=>r.sourceAuditedCompletion,appendOnlySensitivity:r=>r.appendOnlySensitivityCompletion,
   optionalConfigShapeSensitivity:r=>r.optionalConfigShapeSensitivityCompletion,interruptedAssignments:r=>r.exit.administrativeInterruption,
   missingFinalUsageAggregates:r=>r.usage.cost===null}))assert.equal(s[field],selected.filter(predicate).length,field);
  assert.equal(s.durationMs,sum(selected,r=>r.durationMs));
  assert.equal(s.scopeFeedbackTrials,selected.filter(r=>r.scopeFeedbackOffered>0).length);assert.equal(s.scopeFollowupTrials,selected.filter(r=>r.scopeFollowups.length>0).length);assert.equal(s.scopeSuccessfulFollowupCommands,selected.reduce((n,r)=>n+new Set(r.scopeFollowups.map(f=>f.validationIndex)).size,0));
  for(const field of ['pathRecoveryOffered','pathRecoveryFollowed','pathRecoveryDirectlyFollowed'])assert.equal(s[field],selected.reduce((n,r)=>n+(r[field]??0),0));
  assert.equal(s.knownPartialReceiptUsd,selected.filter(r=>r.usage.cost===null).reduce((n,r)=>n+r.usage.perRequest.reduce((m,u)=>m+(u.cost??0),0),0));
 }
 for(const other of ['reference','cline']){
  const all=summary.allAssignedComparisons[`${treatment}/${other}`],a=rows.filter(r=>r.arm===treatment),b=rows.filter(r=>r.arm===other);
  assert.equal(all.assignmentsPerArm,a.length);assert.equal(a.length,b.length);
  assert.equal(all.candidateAudited,a.filter(r=>r.auditedCompletion).length);assert.equal(all.baselineAudited,b.filter(r=>r.auditedCompletion).length);
  const tokens=r=>r.usage.input===null||r.usage.output===null?null:r.usage.input+r.usage.output;
  assert.equal(all.tokenDelta,delta(sum(a,tokens),sum(b,tokens)));
  assert.equal(all.costDelta,delta(sum(a,r=>r.usage.cost),sum(b,r=>r.usage.cost)));
  assert.equal(all.durationDelta,delta(sum(a,r=>r.durationMs),sum(b,r=>r.durationMs)));
  const pairRows=rows.filter(r=>r.arm===treatment&&r.auditedCompletion).map(r=>[r,rows.find(b=>b.arm===other&&b.repeat===r.repeat&&b.task===r.task&&b.auditedCompletion)]).filter(([,b])=>b);
  const c=summary.comparisons[`${treatment}/${other}`];assert.equal(c.pairs,pairRows.length);
  for(const[index,key]of [[0,'candidate'],[1,'baseline']]){
   const selected=pairRows.map(p=>p[index]),known=selected.every(r=>r.contract.unreported===0&&r.usage.tokensCostReconciled);
   assert.equal(c[key].trials,selected.length);assert.equal(c[key].tokens,known?sum(selected,r=>r.usage.input+r.usage.output):null);
   assert.equal(c[key].cost,known?sum(selected,r=>r.usage.cost):null);assert.equal(c[key].durationMs,sum(selected,r=>r.durationMs));
  }
  assert.equal(c.tokenDelta,delta(c.candidate.tokens,c.baseline.tokens));assert.equal(c.costDelta,delta(c.candidate.cost,c.baseline.cost));assert.equal(c.durationDelta,delta(c.candidate.durationMs,c.baseline.durationMs));
 }
 const quality=summary.arms[treatment].audited>=summary.arms.reference.audited;
 const mechanism=rows.some(r=>r.arm===treatment&&r.scopeFollowups.length>0);
 const c=summary.comparisons[`${treatment}/reference`];
 const resources=quality&&mechanism&&c.pairs>=(protocol.criteria.minimumPairedSuccesses??12)&&c.tokenDelta!==null&&c.tokenDelta<0&&c.costDelta!==null&&c.costDelta<0&&c.durationDelta!==null&&c.durationDelta<=0.1;
 assert.equal(summary.retainDefaultFeedback,quality&&mechanism&&(summary.arms[treatment].audited>summary.arms.reference.audited||resources));
 assert.equal(summary.qualityGate,quality);assert.equal(summary.mechanismGate,mechanism);assert.equal(summary.resourceGate,resources);
}
