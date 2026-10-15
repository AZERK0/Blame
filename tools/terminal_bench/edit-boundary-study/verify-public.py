"""Recompute F31 recorded outcomes, paired resources and reserves from public bytes.
No model, private workspace, npm dependency, oracle execution or recovered solution.
Manual review decisions are verified/replayed, not independently re-adjudicated.
"""
import gzip, hashlib, json, math, sys
import re
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
 if 'manualBehaviorPassed' in r:
  assert type(r['manualBehaviorPassed']) is bool and r['manualBehaviorPassed']==review['manualBehaviorPassed']
  assert r['manualBehaviorPassed'] or not review['fullRequestCriteriaPassed']
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
  if all('manualBehaviorPassed' in r for r in rs):
   assert summary['arms'][arm]['manualBehaviorReviewed']==len(rs)
   assert summary['arms'][arm]['manualBehaviorPassed']==sum(r['manualBehaviorPassed'] for r in rs)
   assert summary['arms'][arm]['manualBehaviorFailures']==sum(not r['manualBehaviorPassed'] for r in rs)
  strata[phase][arm]=totals
for repeat in summary['repetitions']:
 for arm,total in repeat['arms'].items():
  rs=[r for r in rows if r['repetition']==repeat['repetition'] and r['arm']==arm]
  expected={'trials':len(rs),'official':sum(r['officialRuntimeSuccess'] for r in rs),'functional':sum(r['independentFunctionalSuccess'] for r in rs),'strict':sum(r['auditedCompletion'] for r in rs),'tokensObserved':sum((r['usage']['input'] or 0)+(r['usage']['output'] or 0) for r in rs),'estimatedUsdObserved':sum(r['usage']['cost'] or 0 for r in rs),'runnerSecondsObserved':sum(r['durationMs'] or 0 for r in rs)/1000}
  for key,value in expected.items():assert close(value,total[key]),(repeat['repetition'],arm,key)
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
controls=read('task-controls.json')
assert controls['paidRequests']==0 and len(controls['rows'])==2
for c in controls['rows']:
 assert c['unchanged']['feature']['exitCode']==c['unchanged']['selected']['exitCode']==1
 assert c['unchanged']['full']['exitCode']==0
 assert all(r['exitCode']==0 for r in c['positive'].values())
 assert len(c['mutants'])==2 and all(m['build']['exitCode']!=0 or m['result']['exitCode']!=0 or m['selected']['exitCode']!=0 for m in c['mutants'])
 assert c['protectedNegative']['exitCode']==1
runtime=read('runtime-controls.json')
assert runtime['paidRequests']==0 and len(runtime['rows'])==4
assert all(r['exitCode']==r['expectedExitCode'] for r in runtime['rows'])
assert runtime['contracts'][0]['tools']==runtime['contracts'][1]['tools']
assert [(r['arm'],r['repeatedWholeReplacementStable']) for r in runtime['knownInputReplay']['replays']]==[('baseline',False),('candidate',True)]
assert read('isolation-controls.json')['differentExecutableFiles']==['harness/light-edit.js']
assert sha((root/'candidate.patch').read_bytes())==read('execution-bindings.json')['versions']['candidate']['source']['patchSha256']
assert sha(b'')==read('execution-bindings.json')['versions']['baseline']['source']['patchSha256']
assert all(r['dateFrozen'] and r['realClock'] for r in read('prompt-date-controls.json')['rows'])
# Actual wire contracts match in full; only the original checkout path is normalized.
treatment=read('schema-treatment.json')
assert treatment['paidRequests']==0
observations={r['name']:r for r in treatment['rows']}
for name,observation in observations.items():
 request=next(q for q in wire[name] if not q['budgetRejected'])
 tools=wire_data['contracts']['schema-'+request['toolsSha256']+'.json']
 prompt=wire_data['contracts']['prompt-'+request['promptSha256']+'.json']
 score=json.loads(raw[name,'score.json'])
 assert observation['toolsSha256']==request['toolsSha256'] and observation['promptSha256']==request['promptSha256']
 assert observation['unchangedToolContractSha256']==sha(js(tools))
 assert observation['normalizedPromptSha256']==sha(js(prompt).replace(score['selected']['cwd'].encode(),b'<WORKSPACE>'))
 assert observation['schemaBytes']==len(js(tools))
for pair in treatment['pairs']:
 a,b=[next(o for o in observations.values() if o['id']==pair['id'] and o['repetition']==pair['repetition'] and o['arm']==arm) for arm in ['baseline','candidate']]
 assert a['toolsSha256']==b['toolsSha256'] and a['normalizedPromptSha256']==b['normalizedPromptSha256']
 assert pair['allOtherToolFieldsMatch'] and pair['normalizedPromptsMatch']
 assert pair['schemaRelativeChange']==pair['descriptionRelativeChange']==0
# Retain the preceding campaign's observed estimates and unresolved reserves.
ledger=read('prior-budget.json')
assert close(ledger['observedUsd']+ledger['reservedUsd'],ledger['accountedUsd'])
assert close(ledger['accountedUsd'],prior['priorObservedCost'])
witness=(root/ledger['witness']['artifact']).read_bytes();assert sha(witness)==ledger['witness']['sha256']
documents=json.loads(gzip.decompress(witness))['documents']
for name,doc in documents.items():assert sha(doc['utf8'].encode())==doc['sha256']==ledger['sourceDocuments'][name]
parent={name:json.loads(doc['utf8']) for name,doc in documents.items()}
assert parent['guidance-summary.json']['completed']==parent['public-replay.json']['completed']==27
assert close(parent['public-replay.json']['totalAccountedUsd'],ledger['accountedUsd'])
assert close(parent['prior-budget.json']['observedUsd']+parent['guidance-summary.json']['accounting']['observedUsd'],ledger['observedUsd'])
assert close(parent['prior-budget.json']['reservedUsd']+parent['guidance-summary.json']['accounting']['reservedUsd'],ledger['reservedUsd'])
# Pinned source,submodule test inputs and dependency calibration remain public.
import io,tarfile
bindings=read('execution-bindings.json')
for project in read('upstreams.json'):
 name=project['project'];archive=(root/'preparation'/f'{name}-source.tar.gz').read_bytes()
 assert sha(archive)==project['archiveSha256']==bindings['projects'][name]['source']
 unpacked=gzip.decompress(archive);assert sha(unpacked)==project['uncompressedArchiveSha256']
 assert sha(gzip.decompress((root/'preparation'/f'{name}-package-lock.json.gz').read_bytes()))==project['lockSha256']==bindings['projects'][name]['lock']
 with tarfile.open(fileobj=io.BytesIO(unpacked)) as tar:
  for task in protocol['tasks']:
   if task['project']==name:
    for path,digest in task['selectedSourceSha256'].items():assert sha(tar.extractfile(path).read())==digest
# A successful source replay may reproduce a behavioral failure; no grade rewriting.
if (root/'behavior-public-replay.json').exists():
 replay=read('behavior-public-replay.json');assert replay['paidRequests']==0 and replay['node']==bindings['node']
 assert replay['completed']==len(rows)==len(replay['rows']) and replay['planned']==results['planned']
 for record,r in zip(replay['rows'],rows):
  assert record['name']==r['name'] and record['diffSha256']==sha(raw[r['name'],'workspace.diff'])
  assert record['scoreSha256']==sha(raw[r['name'],'score.json'])
  score=json.loads(raw[r['name'],'score.json'])
  assert record['sourceSha256']==score['sourceSha256'] and record['sourceUnchangedByReplay']
  assert record['frozenUtcProbesMatched'] and record['suppliedExitCode']==score['selected']['exitCode']
decision=read('decision.json')
contrast=next(c for c in summary['comparisons'] if c['left']=='candidate' and c['right']=='baseline' and c['tier']=='strict')
quality=all(t['arms']['candidate']['strict']>=t['arms']['baseline']['strict'] and t['arms']['candidate']['manualBehaviorPassed']>=t['arms']['baseline']['manualBehaviorPassed'] for t in summary['tasks'])
r=contrast['resources'];available=contrast['pairs']>0 and all(isinstance(r[k]['relativeChange'],(int,float)) for k in ['tokens','cost','seconds'])
resource=available and (r['tokens']['relativeChange']<=-.1 or r['cost']['relativeChange']<=-.1) and r['cost']['relativeChange']<=.05 and r['seconds']['relativeChange']<=.1
assert decision['qualityGate']==quality and decision['resourceGate']==resource
assert decision['registeredGate']==protocol['decisionGate']
assert decision['complete']==(results['completed']==results['planned'])
assert results['completed']==len(rows)==len(reviews)
assert results['planned']==len(protocol['order'])==len(protocol['tasks'])*protocol['repetitions']*len(protocol['arms'])
assert [{k:r[k] for k in ['repetition','id','arm']} for r in rows]==protocol['order'][:len(rows)]
assert sha((root/'results.json').read_bytes())==read('checks.json')['resultsSha256']
assert read('launch-registration.json')['protocolSha256']==sha((root/'protocol.json').read_bytes())
assert protocol['readyForModel'] and protocol['financialBinding']['priorBudgetSha256']==sha((root/'prior-budget.json').read_bytes())
assert close(summary['referenceEquivalentEur'],summary['totalAccountedUsd']/protocol['budgetAmendment']['referenceFx']['usdPerEur'])
print(json.dumps({'paidRequests':0,'method':'Public byte/hash,recorded outcomes,research-agent decisions,full initial contracts,paired resources and reserve replay; no independent adjudication or model calls.','completed':len(rows),'planned':results['planned'],'rawArtifactsVerified':len(raw),'executionAuditsVerified':len(evidence['audits']),'strata':strata,'newWireUsageGaps':gaps,'observedUsd':observed,'reservedUsd':reserved,'priorAccountedUsd':prior['priorObservedCost'],'totalAccountedUsd':accounted+prior['priorObservedCost'],'pairedComparisonsVerified':len(summary['comparisons'])+len(summary['observedAggregateComparisons'])},indent=2))
