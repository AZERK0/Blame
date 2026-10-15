"""Recompute F28 recorded outcomes, paired resources and reserves from public bytes.
No model, private workspace, npm dependency, oracle execution or recovered solution.
Manual review decisions are verified/replayed, not independently re-adjudicated.
"""
import gzip, hashlib, json, math, sys
from pathlib import Path
root=Path(sys.argv[1])
read=lambda p:json.loads((root/p).read_text())
sha=lambda b:hashlib.sha256(b).hexdigest()
close=lambda a,b:math.isclose(a,b,rel_tol=1e-10,abs_tol=1e-12)
protocol,results,summary=read('protocol.json'),read('results.json'),read('guidance-summary.json')
assert results['provenance']['protocolSha256']==sha((root/'protocol.json').read_bytes())
assert results['provenance']['frozen']==read('execution-bindings.json')
raw={}
for entry in read('inventory.json'):
 if entry.get('missing'):continue
 b=gzip.decompress((root/entry['artifact']).read_bytes())
 assert len(b)==entry['bytes'] and sha(b)==entry['sha256'],entry['artifact']
 raw[entry['trial'],entry['file']]=b
reviews={r['name']:r for r in read('source-review.json')['decisions']}
wire_bytes=(root/'wire-contracts.json.gz').read_bytes()
assert sha(wire_bytes)==read('wire-inventory.json')['sha256']
wire_data=json.loads(gzip.decompress(wire_bytes))
js=lambda value:json.dumps(value,ensure_ascii=False,separators=(',',':')).encode()
for file,content in wire_data['contracts'].items():
 assert sha(js(content))==file.split('-',1)[1][:-5],file
wire={r['name']:r['requests'] for r in wire_data['trials']}
for trial in wire_data['trials']:
 assert sha(b''.join(js(q)+b'\n' for q in trial['requests']))==trial['metadataSha256']
 for q in trial['requests']:
  assert q['model']==protocol['model'] and q['reasoning']['effort']==protocol['effort']
  assert q['byteLimit']==protocol['budgets']['maximumSerializedRequestBytes']
  assert q['budgetRejected']==(q['requestBytes']>q['byteLimit'])
  assert q['maximumOutputTokens'] is None
  assert 'schema-'+q['toolsSha256']+'.json' in wire_data['contracts']
  assert 'prompt-'+q['promptSha256']+'.json' in wire_data['contracts']
rows=results['rows'];accounted=0;observed=0;reserved=0;gaps=0;gap_by_name={}
for r in rows:
 name=r['name'];review=reviews[name]
 for file,key in [('events.jsonl','eventsSha256'),('workspace.diff','diffSha256'),('score.json','scoreSha256')]:
  assert sha(raw[name,file])==r[key]==review[key]
 execution=json.loads(raw.get((name,'result.json'),b'{}'));score=json.loads(raw[name,'score.json'])
 events=[json.loads(line)['event'] for line in raw[name,'events.jsonl'].splitlines() if line]
 reports=[e['payload']['usage'] for e in events if e['type']=='usage']
 assert len(reports)==len(r['usage']['perRequest'])
 for report,normalized in zip(reports,r['usage']['perRequest']):
  for key,field in [('inputTokens','input'),('outputTokens','output'),('cost','cost')]:
   value=report.get(key)
   if isinstance(value,(int,float)):assert close(value,normalized[field]),(name,key)
 if r['usage']['tokensCostReconciled']:
  for key in ['input','output','cost']:
   assert all(isinstance(q[key],(int,float)) for q in r['usage']['perRequest'])
   assert close(sum(q[key] for q in r['usage']['perRequest']),r['usage'][key])
 assert r['officialRuntimeSuccess']==(execution.get('status')=='succeeded')
 assert r['independentFunctionalSuccess']==score['independentFunctionalSuccess']
 if execution:
  for key,expected in [('modelId',protocol['model']),('reasoningEffort',protocol['effort']),('providerId',protocol['provider']),('maxIterations',protocol['budgets']['maxIterations']),('timeoutMs',protocol['budgets']['timeoutSeconds']*1000)]:assert execution[key]==expected,(name,key)
 assert r['partition']==next(t.get('partition','confirmation') for t in protocol['tasks'] if t['id']==r['id'])
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
for phase in ['fresh-confirmation']:
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
  available=[(a,b) for a,b in pairs if metric!='seconds' or isinstance(a['durationMs'],(int,float)) and isinstance(b['durationMs'],(int,float))]
  left=sum(fn(a) for a,b in available);right=sum(fn(b) for a,b in available);resource=c['resources'][metric]
  assert resource['pairs']==len(available) and resource['missingPairs']==len(pairs)-len(available)
  assert close(left,resource['left']) and close(right,resource['right'])
  if not available:assert resource['relativeChange'] is None
  else:assert close(left/right-1,resource['relativeChange'])
evidence=read('evidence-checks.json')
for audit in evidence['audits']:
 b=gzip.decompress((root/audit['artifact']).read_bytes());assert len(b)==audit['bytes'] and sha(b)==audit['sha256']
 assert [json.loads(line) for line in b.splitlines() if line]==audit['records']
admin_path=root/'administrative-recovery.json'
if admin_path.exists():
 admin=json.loads(admin_path.read_text());artifacts={}
 for entry in admin['inventory']:
  b=gzip.decompress((root/entry['artifact']).read_bytes());assert len(b)==entry['bytes'] and sha(b)==entry['sha256']
  artifacts[entry['file']]=b
 continuation=json.loads(artifacts['continuation.json']);interruption=json.loads(artifacts['preparation-interruption.json'])
 assert not interruption['modelDispatched'] and interruption['modelRetries']==0 and not interruption['sourceRepair']
 assert continuation['completedPrefix']==13 and continuation['modelRetries']==0 and not continuation['sourceRepair']
 assert continuation['driverSha256']==results['provenance']['frozen']['inputs'][continuation['driver']]
 for name,files in continuation['completedTrialHashes'].items():
  if name in reviews:
   for file,expected in files.items():assert sha(raw[name,file])==expected
 compact=[json.loads(line) for line in artifacts['object-compaction.jsonl'].splitlines() if line]
 assert len(compact)==continuation['compaction']['repositories'] and all(r['identitiesAndDiffPreserved'] for r in compact)
 assert sum(r['objectEntriesBefore']-r['objectEntriesAfter'] for r in compact)==continuation['compaction']['freedObjectEntries']
assert results['completed']==len(rows)==len(reviews)
assert sha((root/'results.json').read_bytes())==read('checks.json')['resultsSha256']
assert results['planned']==len(protocol['order'])==len(protocol['tasks'])*protocol['repetitions']*len(protocol['arms'])
assert [{k:r[k] for k in ['repetition','id','arm']} for r in rows]==protocol['order'][:len(rows)]
assert close(summary['referenceEquivalentEur'],summary['totalAccountedUsd']/protocol['budgetAmendment']['referenceFx']['usdPerEur'])
assert summary['limits']['authorizedEur']==10
print(json.dumps({'paidRequests':0,'method':'Public byte/hash,recorded outcome,manual decision,paired resource and reserve replay; not independent source adjudication. Missing consumption retained.','completed':len(rows),'planned':results['planned'],'rawArtifactsVerified':len(raw),'executionAuditsVerified':len(evidence['audits']),'strata':strata,'newWireUsageGaps':gaps,'observedUsd':observed,'reservedUsd':reserved,'priorAccountedUsd':prior['priorObservedCost'],'totalAccountedUsd':accounted+prior['priorObservedCost'],'pairedComparisonsVerified':len(summary['comparisons'])+len(summary['observedAggregateComparisons'])},indent=2))
