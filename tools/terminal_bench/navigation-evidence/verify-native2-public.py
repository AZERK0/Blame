"""Recompute F27 recorded outcomes, paired resources and reserves from public bytes.
No model, private workspace, npm dependency, oracle execution or recovered solution.
Manual review decisions are verified/replayed, not independently re-adjudicated.
"""
import gzip, hashlib, json, math, sys
from pathlib import Path
root=Path(sys.argv[1])
read=lambda p:json.loads((root/p).read_text())
sha=lambda b:hashlib.sha256(b).hexdigest()
close=lambda a,b:math.isclose(a,b,rel_tol=1e-10,abs_tol=1e-12)
protocol,results,summary=read('protocol.json'),read('results.json'),read('native-summary.json')
assert results['provenance']['protocolSha256']==sha((root/'protocol.json').read_bytes())
assert results['provenance']['frozen']==read('execution-bindings.json')
raw={}
for entry in read('inventory.json'):
 if entry.get('missing'):continue
 b=gzip.decompress((root/entry['artifact']).read_bytes())
 assert len(b)==entry['bytes'] and sha(b)==entry['sha256'],entry['artifact']
 raw[entry['trial'],entry['file']]=b
reviews={r['name']:r for r in read('source-review.json')['decisions']}
wire=json.loads(gzip.decompress((root/'wire-contracts.json.gz').read_bytes()))
wire={r['name']:r['requests'] for r in wire['trials']}
rows=results['rows'];accounted=0;observed=0;reserved=0;gaps=0;gap_by_name={}
for r in rows:
 name=r['name'];review=reviews[name]
 for file,key in [('events.jsonl','eventsSha256'),('workspace.diff','diffSha256'),('score.json','scoreSha256')]:
  assert sha(raw[name,file])==r[key]==review[key]
 execution=json.loads(raw.get((name,'result.json'),b'{}'));score=json.loads(raw[name,'score.json'])
 assert r['officialRuntimeSuccess']==(execution.get('status')=='succeeded')
 assert r['independentFunctionalSuccess']==score['independentFunctionalSuccess']
 if execution:
  for key,expected in [('modelId',protocol['model']),('reasoningEffort',protocol['effort']),('providerId',protocol['provider']),('maxIterations',protocol['budgets']['maxIterations']),('timeoutMs',protocol['budgets']['timeoutSeconds']*1000)]:assert execution[key]==expected,(name,key)
 assert r['partition']==next(t['partition'] for t in protocol['tasks'] if t['id']==r['id'])
 accepted=all([r['independentFunctionalSuccess'],review['agentRequiredChecksPassed'],review['fullRequestCriteriaPassed'],review['noSolutionRetrieval'],r['officialRuntimeSuccess']])
 assert r['auditedCompletion']==accepted
 aggregate=execution.get('usage',{}).get('aggregateUsage',{})
 for key,recorded in [('totalInputTokens','input'),('totalOutputTokens','output'),('totalCacheReadTokens','cacheRead'),('totalCacheWriteTokens','cacheWrite'),('totalCost','cost')]:
  if isinstance(aggregate.get(key),(int,float)) and r['usage'][recorded] is not None:assert close(aggregate[key],r['usage'][recorded]),(name,key)
 forwarded=sum(not q.get('budgetRejected') for q in wire[name]);reports=len(r['usage'].get('perRequest',[]))
 gap=max(0,forwarded-reports);gaps+=gap;gap_by_name[name]=gap
 cost=r['usage']['cost'];missing=cost is None
 allowance=(protocol['budgets']['perTrialSdkCostLimitUsd']+protocol['budgets']['requestOvershootReserveUsd']) if missing else 0
 reserve=allowance+max(0,gap-int(missing))*protocol['budgets']['requestOvershootReserveUsd']
 observed+=0 if missing else cost;reserved+=reserve;accounted+=(0 if missing else cost)+reserve
assert close(observed,summary['accounting']['observedUsd'])
assert close(reserved,summary['accounting']['reservedUsd'])
assert close(accounted,summary['accounting']['accountedUsd'])
prior=read('shared-budget-accounting.json')
assert close(sum(r['observedOrReservedUsd'] for r in prior['priorAccounting']),prior['priorObservedCost'])
assert close(prior['priorObservedCost']+accounted,summary['totalAccountedUsd'])
assert summary['totalAccountedUsd']<=protocol['budgets']['sharedStudyObservedCostStopUsd']+1e-12
strata={}
for phase in protocol['phaseOrder']:
 strata[phase]={}
 for arm in protocol['arms']:
  rs=[r for r in rows if r['partition']==phase and r['arm']==arm]
  totals={'trials':len(rs),'official':sum(r['officialRuntimeSuccess'] for r in rs),'functional':sum(r['independentFunctionalSuccess'] for r in rs),'strict':sum(r['auditedCompletion'] for r in rs),'tokensObserved':sum((r['usage']['input'] or 0)+(r['usage']['output'] or 0) for r in rs),'estimatedUsdObserved':sum(r['usage']['cost'] or 0 for r in rs),'runnerSecondsObserved':sum(r['durationMs'] or 0 for r in rs)/1000,'missingConsumption':sum(any(r['usage'][k] is None for k in ['input','output','cost']) for r in rs)}
  for field,key in [('inputTokensObserved','input'),('outputTokensObserved','output'),('cacheReadTokensObserved','cacheRead'),('cacheWriteTokensObserved','cacheWrite')]:totals[field]=sum(r['usage'][key] or 0 for r in rs)
  for field,key in [('missingCacheReadAggregates','cacheRead'),('missingCacheWriteAggregates','cacheWrite'),('missingReasoningAggregates','reasoning')]:totals[field]=sum(r['usage'][key] is None for r in rs)
  for key,value in totals.items():assert close(value,summary['strata'][phase]['arms'][arm][key]),(phase,arm,key)
  strata[phase][arm]=totals
for c in summary['comparisons']+summary['observedAggregateComparisons']:
 def accept(r):return r['partition']==c['partition'] and r['officialRuntimeSuccess'] and r['independentFunctionalSuccess'] and r['agentRequiredChecksPassed'] and r['noSolutionRetrieval'] and r['usage']['tokensCostReconciled'] and (c['tier']!='strict' or r['auditedCompletion']) and (c['accountingTier']=='aggregate_only' or gap_by_name[r['name']]==0)
 pairs=[(a,b) for a in rows if a['arm']==c['left'] and accept(a) for b in rows if b['arm']==c['right'] and b['id']==a['id'] and b['repetition']==a['repetition'] and accept(b)]
 assert len(pairs)==c['pairs']
 for metric,fn in [('tokens',lambda r:r['usage']['input']+r['usage']['output']),('cost',lambda r:r['usage']['cost']),('seconds',lambda r:r['durationMs']/1000)]:
  left=sum(fn(a) for a,b in pairs);right=sum(fn(b) for a,b in pairs);resource=c['resources'][metric]
  assert close(left,resource['left']) and close(right,resource['right'])
  if not pairs:assert resource['relativeChange'] is None
  else:assert close(left/right-1,resource['relativeChange'])
evidence=read('native-evidence-checks.json')
raw_trial_count=len(raw)
for audit in evidence['repairAudits']:
 b=gzip.decompress((root/audit['artifact']).read_bytes());assert len(b)==audit['bytes'] and sha(b)==audit['sha256']
recovery=read('orchestration-recovery.json');continuation=read('resume-manifest.json');admin=evidence['administrativeContinuation']
for file,key in [('registered-driver.mjs.gz','originalDriverSha256'),('administrative-driver.mjs.gz','administrativeDriverSha256'),('original-orchestration.log.gz','originalLogSha256'),('continued-orchestration.log.gz','continuedLogSha256')]:assert sha(gzip.decompress((root/file).read_bytes()))==admin[key]
for entry in admin['preservedArtifacts']:
 b=gzip.decompress((root/entry['artifact']).read_bytes());assert len(b)==entry['bytes'] and sha(b)==entry['sha256']
 raw[recovery['affectedTrial'],entry['file']]=b
for file,expected in recovery['originalFileSha256'].items():assert sha(raw[recovery['affectedTrial'],'workspace.diff' if file=='workspace.diff.beforeScoring' else file])==expected
recovered=next(r for r in rows if r['name']==recovery['affectedTrial'])
assert recovered['outerAgentMs'] is None and recovered['exit']['code'] is None and recovered['exit']['orchestrationInterrupted']
assert recovered['durationMs']==recovery['recordedWorkerDurationMs']
print(json.dumps({'paidRequests':0,'method':'Public bytes and recorded-review replay, not independent source adjudication or oracle execution. Missing consumption stays missing; reserves are separate.','completed':len(rows),'planned':results['planned'],'rawTrialArtifactsVerified':raw_trial_count,'recoveredSupplementalFilesVerified':len(admin['preservedArtifacts']),'strata':strata,'newWireUsageGaps':gaps,'observedUsd':observed,'reservedUsd':reserved,'priorAccountedUsd':prior['priorObservedCost'],'totalAccountedUsd':accounted+prior['priorObservedCost'],'orchestrationInterruptions':sum(bool(r['exit'].get('orchestrationInterrupted')) for r in rows),'pairedComparisonsVerified':len(summary['comparisons'])+len(summary['observedAggregateComparisons'])},indent=2))
