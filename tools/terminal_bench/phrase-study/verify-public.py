"""Recompute F29 recorded outcomes, paired resources and reserves from public bytes.
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
# Post-result timing replay must retain the registered failed score, never rescue it.
if (root/'window-timing-diagnostic.json').exists():
 diagnostic=read('window-timing-diagnostic.json');name=diagnostic['trial']
 if name in reviews:
  assert diagnostic['paidRequests']==0 and diagnostic['postSelectedDiagnostic']
  assert diagnostic['originalScoreSha256']==sha(raw[name,'score.json'])
  assert diagnostic['originalDiffSha256']==sha(raw[name,'workspace.diff'])
  original=json.loads(raw[name,'score.json'])
  assert not original['independentFunctionalSuccess'] and original['full']['exitCode']==1
  assert 'should window when Promise resolves' in original['full']['stdout']
  controls=diagnostic['rows'];assert [r['endpoint'] for r in controls]==['unchanged-input','recorded-model-endpoint']
  assert controls[0]['specSha256']==controls[1]['specSha256']
  assert controls[1]['diffSha256']==diagnostic['originalDiffSha256']
  assert all(len(r['invocations'])==6 for r in controls)
  assert all(i['scope']==('full-suite' if i['repetition']==6 else 'targeted') for r in controls for i in r['invocations'])
for stage in ['before','after']:
 if (root/f'duplicate-header-{stage}.json').exists():
  diagnostic=read(f'duplicate-header-{stage}.json');name=diagnostic['trial']
  assert diagnostic['paidRequests']==0 and diagnostic['postSelectedDiagnostic']
  assert diagnostic['eventsSha256']==sha(raw[name,'events.jsonl'])
  assert diagnostic['recordedPrefixCalls']==24 and diagnostic['rejectedCall']==24
  assert diagnostic['sourceBeforeSha256']==diagnostic['sourceAfterSha256']
  assert diagnostic['rejected']['status']=='blocked'
  recovery=diagnostic['rejected']['recovery'];correction=json.loads(recovery[recovery.index('{'):])['patchCorrection']
  assert correction['patchPaths']==['lodash.js','lodash.js']
  assert correction['reason']==('multiple_files_for_symbol' if stage=='before' else 'multiple_headers_for_symbol')
  if stage=='after':
   before=read('duplicate-header-before.json')
   assert diagnostic['sourceBeforeSha256']==before['sourceBeforeSha256']
   assert diagnostic['editModuleSha256']!=before['editModuleSha256']
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
 assigned=['-'.join(str(t[k]) for k in ['repetition','id','arm']) for t in protocol['order']]
 first_started=re.findall(r'^START (.+)$',artifacts['original-orchestration.log'].decode(),re.M)
 next_started=re.findall(r'^START (.+)$',artifacts['continued-orchestration.log'].decode(),re.M)
 assert first_started==assigned[:13]
 assert next_started==assigned[13:13+len(next_started)]
 assert len(set(first_started+next_started))==len(first_started)+len(next_started)
 for name,files in continuation['completedTrialHashes'].items():
  if name in reviews:
   for file,expected in files.items():assert sha(raw[name,file])==expected
 compact=[json.loads(line) for line in artifacts['object-compaction.jsonl'].splitlines() if line]
 assert len(compact)==continuation['compaction']['repositories'] and all(r['identitiesAndDiffPreserved'] for r in compact)
 assert sum(r['objectEntriesBefore']-r['objectEntriesAfter'] for r in compact)==continuation['compaction']['freedObjectEntries']
projection_path=root/'native-projection-diagnostic.json'
if projection_path.exists():
 projection=json.loads(projection_path.read_text());name=projection['trial']
 assert sha(raw[name,'events.jsonl'])==projection['eventsSha256']
 event_list=[json.loads(line)['event'] for line in raw[name,'events.jsonl'].splitlines() if line]
 call=next(e for e in event_list if e['type']=='tool' and e.get('payload',{}).get('phase')=='finished' and 'npm run types' in e['payload'].get('toolCall',{}).get('input',{}).get('commands',[]))
 text=next(r['result'] for r in call['payload']['output'] if r['query']=='npm test -- --maxWorkers=1 --minWorkers=1 --pool=forks')
 # All characters in this registered output are BMP; Python length/slices match JS UTF-16 here.
 assert all(ord(ch)<=0xffff for ch in text)
 marker=lambda n:'\n\n...[truncated '+str(n)+' chars]...\n\n'
 limit=projection['limit'];first=max(0,(limit-len(marker(len(text)-limit)))//2)
 cut=marker(max(0,len(text)-2*first));keep=max(0,(limit-len(cut))//2)
 expected=text[:keep]+cut+(text[-keep:] if keep else '')
 entry=projection['projectedArtifact'];actual=gzip.decompress((root/entry['artifact']).read_bytes())
 assert sha(actual)==entry['sha256'] and len(actual)==entry['bytes'] and actual==expected.encode()
 assert '3140 passed | 18 skipped' in text and '3140 passed | 18 skipped' not in expected
 assert len(text)==projection['rawCharacters'] and len(expected)==projection['projectedCharacters']
patch_replay_path=root/'recorded-patch-replay.json'
if patch_replay_path.exists():
 patch_replay=json.loads(patch_replay_path.read_text());name=patch_replay['trialSource']
 assert sha(raw[name,'events.jsonl'])==patch_replay['eventsSha256']
 finished=[json.loads(line)['event']['payload'] for line in raw[name,'events.jsonl'].splitlines() if json.loads(line)['event']['type']=='tool' and json.loads(line)['event']['payload'].get('phase')=='finished']
 original=finished[patch_replay['recordedRejectedCall']]['toolCall']['input']
 assert finished[12]['output']['status']=='blocked'
 recovery=json.loads(json.dumps(original))
 for operation in recovery['operations']:operation.pop('target',None)
 for record in patch_replay['rows']:
  assert record['rejected']['status']=='blocked' and record['recoveredStatus']=='ok'
  assert record['recoveryInputSha256']==sha(js(recovery))
  assert ('"patchCorrection"' in record['rejected'].get('recovery',''))==(record['arm']=='patch')
 assert patch_replay['rows'][0]['before']==patch_replay['rows'][1]['before']
 assert patch_replay['rows'][0]['after']==patch_replay['rows'][1]['after']!=patch_replay['rows'][0]['before']
# Local mechanism evidence and the measured snapshot share the exact modules.
if (root/'qualified-target-replay.json').exists():
 recovery=read('qualified-target-replay.json');validation=read('qualified-target-validation.json')
 assert recovery['paidRequests']==validation['paidRequests']==0
 assert recovery['postSelectedDiagnostic'] and recovery['implementedAfterFrozenTreatments']
 assert not validation['modelBenefitMeasured'] and validation['productionLexicalOrderingUnchanged']
 assert validation['productionLexicalModuleHashes']==read('local-controls.json')['bindings']['baseline']
 assert recovery['eventsSha256']==sha(raw[recovery['trial'],'events.jsonl'])
 assert validation['replay']['sha256']==sha((root/'qualified-target-replay.json').read_bytes())
 local_bytes={}
 for entry in validation['inventory']:
  data=gzip.decompress((root/entry['artifact']).read_bytes())
  assert len(data)==entry['bytes'] and sha(data)==entry['sha256'];local_bytes[entry['artifact']]=data
 for source,digest in validation['sources'].items():assert sha(local_bytes[validation['sourceArtifacts'][source]])==digest
 assert 'pass 71' in local_bytes['local-validation/qualified-target-tests-current.log.gz'].decode()
 assert 'fail 0' in local_bytes['local-validation/qualified-target-tests-current.log.gz'].decode()
 assert 'pass 2' in local_bytes['local-validation/qualified-target-frozen-baseline.log.gz'].decode()
 assert 'fail 2' in local_bytes['local-validation/qualified-target-frozen-baseline.log.gz'].decode()
 assert not local_bytes['local-validation/qualified-target-lint.log.gz']
 assert [r['stage'] for r in recovery['rows']]==['before','after']
 for row in recovery['rows']:
  assert row['sourceUnchanged'] and len(row['outcomes'])==5
  assert row['aliasesModuleSha256']==validation['runtimeModules'][row['stage']]['sha256']
  for outcome in row['outcomes']:
   assert outcome['result']['status']=='blocked'
   if row['stage']=='before':assert 'followup' not in outcome
   else:
    assert 'No indexed declaration matches' in outcome['result']['message']
    if 'followup' in outcome:
     suggested=json.loads(outcome['result']['message'].split('Suggested read_code input: ',1)[1])
     assert suggested==outcome['followup']['input']
     assert outcome['followup']['status']=='ok'
     assert outcome['followup']['qualifiedName']==outcome['input']['target'].split('#')[-1].strip()
     assert suggested['target']=='lodash.js#'+outcome['followup']['qualifiedName']
 assert sum('followup' in o for o in recovery['rows'][1]['outcomes'])==4
 assert sum(o['exactControl']['status']=='blocked' for o in recovery['rows'][1]['outcomes'])==1
for diagnostic_file in ['iteratee-default-first-diagnostic.json','iteratee-full-first-diagnostic.json','iteratee-default-diagnostic.json']:
 if not (root/diagnostic_file).exists():continue
 diagnostic=read(diagnostic_file)
 assert diagnostic['paidRequests']==0 and diagnostic['postSelectedDiagnostic'] and diagnostic['original']['sourceUnchanged']
 assert diagnostic['original']['sourceSha256']==next(t for t in protocol['tasks'] if t['id']=='lodash-iterator-own-mode')['selectedSourceSha256']['lodash.js']
 cases,expected=diagnostic['cases'],diagnostic['expected']
 assert len(cases)==len(expected) and len(set(c['id'] for c in cases))==len(cases)
 for c,value in zip(cases,expected):
  assert c['method'] in ['forIn','forInRight'] and c['inputLabel'] in ['zero','false','empty-string','null','undefined','truthy-number','object']
  assert c['optionLabel'] in ['omitted','own-false','own-nontrue','own-true']
  own=c['optionLabel']=='own-true'
  assert c.get('referenceMethod',c['method'])==(('forOwn' if c['method']=='forIn' else 'forOwnRight') if own else c['method'])
  skips=c['inputLabel'] in ['null','undefined'] or own and c['inputLabel'] in ['zero','false','empty-string']
  assert value==('0:returned-input' if skips else '1:sentinel-error')
 for row in diagnostic['rows']:
  assert row['sourceUnchanged'] and row['assessedCases']==len(cases)==len(row['observations'])
  differences=[{'caseId':c['id'],'expected':e,'actual':a} for c,e,a in zip(cases,expected,row['observations']) if e!=a]
  assert differences==row['differences'] and row['allObservedDefaultCasesMatchOriginal']==(not differences)
  if row['name'] not in reviews:continue # Ongoing prefix retains later diagnostic rows without grading them.
  name=row['name'];score=json.loads(raw[name,'score.json'])
  for file,key in [('events.jsonl','eventsSha256'),('workspace.diff','diffSha256'),('score.json','scoreSha256')]:assert sha(raw[name,file])==row[key]
  assert row['sourceSha256']==score['sourceSha256']['lodash.js'] and row['frozenIndependentFunctionalSuccess']==score['independentFunctionalSuccess']
  if differences:assert reviews[name]['manualBehaviorPassed'] is False and not reviews[name]['fullRequestCriteriaPassed']
 if diagnostic_file=='iteratee-default-diagnostic.json' and results['completed']==results['planned']:
  assert len(diagnostic['rows'])==len([r for r in rows if r['id']=='lodash-iterator-own-mode'])==9
local,isolation=read('local-controls.json'),read('isolation-controls.json')
assert local['paidRequests']==0 and local['prototypeOnly']
assert len(local['rows'])==16 and len(local['real'])==8
assert isolation['frozenModuleHashes']==local['bindings']
assert isolation['differentExecutableFiles']==['harness/light-navigation.js','harness/light-workspace.js']
contracts=read('contract-controls.json');contract_logs={}
assert contracts['paidRequests']==0 and contracts['bindings']==local['bindings']
assert sha((root/contracts['testSource']['artifact']).read_bytes())==contracts['testSource']['sha256']
assert contracts['baseline']['pass']==6 and contracts['baseline']['fail']==2
assert contracts['candidate']['pass']==8 and contracts['candidate']['fail']==0
for entry in contracts['inventory']:
 data=gzip.decompress((root/entry['artifact']).read_bytes())
 assert len(data)==entry['bytes'] and sha(data)==entry['sha256']
 contract_logs[entry['artifact']]=data.decode()
assert 'pass 8' in contract_logs['local-validation/phrase-tests-candidate-final.log.gz'] and 'fail 0' in contract_logs['local-validation/phrase-tests-candidate-final.log.gz']
assert 'pass 6' in contract_logs['local-validation/phrase-tests-baseline-final.log.gz'] and 'fail 2' in contract_logs['local-validation/phrase-tests-baseline-final.log.gz']
latency=read('latency-controls.json')
assert latency['paidRequests']==0 and latency['bindings']==local['bindings']
assert len(latency['rows'])==120
for group in latency['groups']:
 values=sorted(r['durationMs'] for r in latency['rows'] if all(r[k]==group[k] for k in ['engine','query','arm']) and not r['warmup'])
 assert group['n']==len(values)==9
 assert close(group['medianMs'],values[4]) and close(group['minimumMs'],values[0]) and close(group['maximumMs'],values[-1])
assert sha((root/'candidate.patch').read_bytes())==read('execution-bindings.json')['versions']['candidate']['source']['patchSha256']
assert sha(b'')==read('execution-bindings.json')['versions']['baseline']['source']['patchSha256']
for row in local['real']:
 assert row['result']['status']=='ok'
 assert (row['result']['data']['results'][0]['lines'][0]==row['expectedDeclarationLine'])==(row['arm']=='candidate')
ledger=read('prior-budget.json')
assert close(ledger['observedUsd']+ledger['reservedUsd'],ledger['accountedUsd'])
assert close(ledger['accountedUsd'],prior['priorObservedCost'])
assert protocol['readyForModel'] and protocol['financialBinding']['priorBudgetSha256']==sha((root/'prior-budget.json').read_bytes())
witness_bytes=(root/ledger['witness']['artifact']).read_bytes()
assert sha(witness_bytes)==ledger['witness']['sha256']==protocol['financialBinding']['parentWitnessSha256']
witness=json.loads(gzip.decompress(witness_bytes))['documents']
for name,document in witness.items():
 assert sha(document['utf8'].encode())==document['sha256']==ledger['sourceDocuments'][name]
parent={name:json.loads(document['utf8']) for name,document in witness.items()}
for name in ['guidance-summary.json','public-replay.json','checks.json']:
 assert parent[name]['completed']==parent[name]['planned']==108
assert parent['checks.json']['reviewedTraces']==108
assert parent['publication-controls.json']['validReplayPassed']
assert all(c['rejected'] for c in parent['publication-controls.json']['negativeControls'])
parent_summary,parent_shared=parent['guidance-summary.json'],parent['shared-budget-accounting.json']
assert close(sum(e['accounting']['observedUsd'] for e in parent_shared['priorAccounting'])+parent_summary['accounting']['observedUsd'],ledger['observedUsd'])
assert close(sum(e['accounting']['reservedUsd'] for e in parent_shared['priorAccounting'])+parent_summary['accounting']['reservedUsd'],ledger['reservedUsd'])
assert close(parent_summary['totalAccountedUsd'],ledger['accountedUsd'])
assert close(parent['public-replay.json']['totalAccountedUsd'],ledger['accountedUsd'])
assert close(parent['protocol.json']['budgets']['sharedStudyObservedCostStopUsd'],protocol['budgets']['sharedStudyObservedCostStopUsd'])
assert read('launch-registration.json')['protocolSha256']==sha((root/'protocol.json').read_bytes())
assert read('launch-registration.json')['paidRequestsAtRegistration']==0
assert results['completed']==len(rows)==len(reviews)
assert sha((root/'results.json').read_bytes())==read('checks.json')['resultsSha256']
assert results['planned']==len(protocol['order'])==len(protocol['tasks'])*protocol['repetitions']*len(protocol['arms'])
assert [{k:r[k] for k in ['repetition','id','arm']} for r in rows]==protocol['order'][:len(rows)]
assert close(summary['referenceEquivalentEur'],summary['totalAccountedUsd']/protocol['budgetAmendment']['referenceFx']['usdPerEur'])
assert summary['limits']['authorizedEur']==10
print(json.dumps({'paidRequests':0,'method':'Public byte/hash,recorded outcome,manual decision,paired resource and reserve replay; not independent source adjudication. Missing consumption retained.','completed':len(rows),'planned':results['planned'],'rawArtifactsVerified':len(raw),'executionAuditsVerified':len(evidence['audits']),'strata':strata,'newWireUsageGaps':gaps,'observedUsd':observed,'reservedUsd':reserved,'priorAccountedUsd':prior['priorObservedCost'],'totalAccountedUsd':accounted+prior['priorObservedCost'],'pairedComparisonsVerified':len(summary['comparisons'])+len(summary['observedAggregateComparisons'])},indent=2))
