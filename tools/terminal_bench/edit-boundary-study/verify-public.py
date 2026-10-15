"""Recompute F31 recorded outcomes, paired resources and reserves from public bytes.
No model, private workspace, npm dependency, oracle execution or recovered solution.
Manual review decisions are verified/replayed, not independently re-adjudicated.
"""
import gzip, hashlib, json, math, sys
from datetime import datetime
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
if (root/'registration-audit.json').exists():
 registration=read('registration-audit.json');launch=read('launch-registration.json')
 first=json.loads(raw[results['rows'][0]['name'],'model-start.json'])
 stamp=lambda s:datetime.fromisoformat(s.replace('Z','+00:00'))
 assert registration['paidRequests']==0 and registration['protocolSha256']==sha((root/'protocol.json').read_bytes())
 assert registration['launchRegistration']==launch and registration['registeredRepoCommit']==launch['gitHead']
 assert registration['firstModelStartUTC']==first['startedAtUTC'] and registration['configuredStudyDateField']==protocol['taskInputCommitAtUTC']
 assert stamp(registration['registeredRepoCommitTime'])<=stamp(launch['recordedAtUTC'])<stamp(first['startedAtUTC'])
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
# Compact validation provenance must copy observations,never upgrade unknowns.
provenance=read('validation-provenance.json')
assert provenance['bindingSha256']==sha((root/'execution-bindings.json').read_bytes())
assert provenance['protocolSha256']==sha((root/'protocol.json').read_bytes())
assert len(provenance['rows'])==len(rows)
for r,record in zip(rows,provenance['rows']):
 name=r['name'];score=json.loads(raw[name,'score.json'])
 assert record['name']==name and record['eventsSha256']==r['eventsSha256'] and record['scoreSha256']==r['scoreSha256']
 assert record['finalScoredSources']==score['sourceSha256']
 assert record['independent']['build']==score['build'] and record['independent']['e2e']==score.get('e2e')
 events=[json.loads(l)['event'] for l in raw[name,'events.jsonl'].splitlines() if l]
 tools=[e['payload'] for e in events if e['type']=='tool' and e['payload'].get('phase')=='finished' and e['payload'].get('toolCall',{}).get('name') in ['run_task','run_commands']]
 assert len(tools)==len(record['actualRecordedAgentCommands'])
 for tool,call in zip(tools,record['actualRecordedAgentCommands']):
  output=tool.get('output');data=output.get('data') if isinstance(output,dict) else None
  data=data if isinstance(data,dict) else {}
  completed=data.get('completed',{}).get('data',data)
  reporting=completed.get('reporting');check=completed.get('check')
  check=check if isinstance(check,dict) else None
  assert call['tool']==tool['toolCall']['name'] and call['input']==tool['toolCall']['input']
  assert call['observedExitCode']==completed.get('exitCode',data.get('exitCode'))
  assert call['reporting']==reporting and call['observedCheck']==check
  binding={'invocation':reporting.get('invocationSourceRevisionId'),'completed':reporting.get('completedSourceRevisionId')} if isinstance(reporting,dict) else None
  assert call['recordedSourceBinding']==binding
  assert call['reportedEnvironment']==completed.get('environment',data.get('environment'))
  assert call['manifestEnvironmentEvidence']==((check or {}).get('evidence') or {}).get('manifestEnvironment')
  assert call['admittedValidation']==completed.get('validation',data.get('validation'))
  if call['tool']=='run_commands':assert call['nativeResults']==output
for entry in read('supplemental-inventory.json')['journals']:
 b=gzip.decompress((root/entry['artifact']).read_bytes());assert len(b)==entry['bytes'] and sha(b)==entry['sha256']
if (root/'mechanism-exposure.json').exists():
 exposure=read('mechanism-exposure.json');assert exposure['paidRequests']==0 and len(exposure['rows'])==len(rows)
 for r,record in zip(rows,exposure['rows']):
  events=[json.loads(l)['event'] for l in raw[r['name'],'events.jsonl'].splitlines() if l]
  calls=[e['payload'] for e in events if e['type']=='tool' and e['payload'].get('phase')=='finished' and e['payload'].get('toolCall',{}).get('name')=='edit_code']
  ops=[dict(op,status=(c.get('output') or {}).get('status')) for c in calls for op in (c['toolCall']['input'].get('operations') if isinstance(c['toolCall']['input'].get('operations'),list) else []) if isinstance(op,dict)]
  whole=[o for o in ops if o.get('kind')=='symbol' and o.get('action')=='replace']
  assert record['name']==r['name'] and record['eventsSha256']==r['eventsSha256']
  assert record['wholeSymbolAttempts']==len(whole) and record['successfulWholeSymbolOperations']==sum(o.get('status')=='ok' for o in whole)
  assert record['bodyOnlyAttempts']==sum(o.get('kind')=='symbol' and o.get('action')=='replace_body' for o in ops)
  assert record['fileOrScopedPatchAttempts']==sum(o.get('kind')=='patch' for o in ops)
  assert record['firstLineNormalizationActuallyApplied'] is None
  assert record['mechanismRouteAbsent']==(None if r['arm']=='cline' else not any(o.get('status')=='ok' for o in whole))
if (root/'failure-classification.json').exists():
 classified=read('failure-classification.json');assert classified['paidRequests']==0
 assert len(classified['rows'])==len(rows)
 for r,c in zip(rows,classified['rows']):
  assert c['name']==r['name'] and c['originalRuntimeError']==r['error'] and c['eventsSha256']==r['eventsSha256']
  message=r['error'] if isinstance(r['error'],str) else ''
  byte=re.search(r'Research request byte budget exceeded before dispatch: (\d+) > (\d+)',message)
  iterations=re.search(r'exceeded maxIterations \((\d+)\)',message)
  expected='research_request_byte_guard' if byte else 'max_iterations' if iterations else 'outer_watchdog' if r.get('exit',{}).get('watchdog') else 'completed' if r['officialRuntimeSuccess'] else 'other_or_unknown'
  assert c['mechanism']==expected
  if byte:assert c['requestBytes']==int(byte[1]) and c['byteLimit']==int(byte[2]) and c['rejectedBeforeDispatch']
  if iterations:assert c['maximumIterations']==int(iterations[1])
if (root/'quality-investigation.json').exists():
 investigation=read('quality-investigation.json');decision=read('decision.json');exposure=read('mechanism-exposure.json')
 light=[r for r in exposure['rows'] if r['arm']!='cline']
 assert investigation['paidRequests']==0 and investigation['mechanismExposureSha256']==sha((root/'mechanism-exposure.json').read_bytes())
 assert investigation['registeredGateDecision']==decision['decision'] and investigation['registeredQualityGate']==decision['qualityGate'] and investigation['registeredResourceGate']==decision['resourceGate']
 assert investigation['lightTrials']==len(light)==12 and investigation['successfulWholeSymbolOperations']==sum(r['successfulWholeSymbolOperations'] for r in light)==0
 assert all(r['mechanismRouteAbsent'] for r in light)
for correction in read('source-review.json').get('noteCorrections',[]):
 r=next(r for r in rows if r['name']==correction['name'])
 assert correction['runtimeError']==r['error'] and correction['eventsSha256']==r['eventsSha256'] and correction['scoreSha256']==r['scoreSha256']
 assert reviews[r['name']]['notes']==correction['correctedNotes']
for correction in read('source-review.json').get('adjudicationCorrections',[]):
 r=next(r for r in rows if r['name']==correction['name']);before=correction['originalDecision'];after=correction['correctedDecision']
 assert after==reviews[r['name']] and before['name']==after['name']
 assert before['agentRequiredChecksPassed'] and before['fullRequestCriteriaPassed']
 assert not after['agentRequiredChecksPassed'] and not after['fullRequestCriteriaPassed']
 assert after['criteriaFailures']==['required_exact_npm_wrappers_not_invoked'] and after['resolvedProjectSensitivity']
 for key in ['eventsSha256','diffSha256','scoreSha256','manualBehaviorPassed','noSolutionRetrieval']:assert before[key]==after[key]
 instruction=gzip.decompress((root/'traces'/f"{r['name']}.instruction.txt.gz").read_bytes())
 assert hashlib.sha256(instruction).hexdigest()==correction['instructionSha256']
 for call in correction['projectInvocations']:
  t=next(t for t in read('tool-ledger.json') if t['name']==r['name'])['tools'][call['index']]
  assert t['input']==call['input'] and t['input']['kind']=='project'
  data=t['output']['data'];data=data.get('completed',{}).get('data',data)
  assert data['command']==call['actualCommand'] and data['exitCode']==0
if (root/'review-corrections.json').exists():
 corrections=read('review-corrections.json');source=read('source-review.json')
 for key in ['noteCorrections','adjudicationCorrections']:assert corrections.get(key,[])==source.get(key,[])
if (root/'final-scope-only-sensitivity.json').exists():
 sensitivity=read('final-scope-only-sensitivity.json');assert sensitivity['paidRequests']==0 and sensitivity['postSelectedSensitivity']
 def scope_accept(r):
  relaxed=reviews[r['name']].get('scopeOnlySensitivity') is True and r['manualCriteriaFailures']==['intermediate_source_write_outside_allowlist']
  return all([r['officialRuntimeSuccess'],r['independentFunctionalSuccess'],r['agentRequiredChecksPassed'],r['noSolutionRetrieval'],r['manualBehaviorPassed'],r['auditedCompletion'] or relaxed,r['usage']['tokensCostReconciled']])
 assert sensitivity['relaxedTrials']==[r['name'] for r in rows if not r['auditedCompletion'] and scope_accept(r)]
 for arm in protocol['arms']:assert sensitivity['acceptedCounts'][arm]==sum(r['arm']==arm and scope_accept(r) for r in rows)
 pairs=[(a,b) for a in rows if a['arm']=='candidate' and scope_accept(a) for b in rows if b['arm']=='baseline' and b['id']==a['id'] and b['repetition']==a['repetition'] and scope_accept(b)]
 assert sensitivity['pairs']==len(pairs)
 for metric,fn in [('tokens',lambda r:r['usage']['input']+r['usage']['output']),('cost',lambda r:r['usage']['cost']),('seconds',lambda r:r['durationMs']/1000)]:
  left=sum(fn(a) for a,b in pairs);right=sum(fn(b) for a,b in pairs);resource=sensitivity['resources'][metric]
  assert resource['pairs']==len(pairs) and close(resource['left'],left) and close(resource['right'],right)
  assert resource['relativeChange'] is None if not right else close(resource['relativeChange'],left/right-1)
if (root/'reporting-only-sensitivity.json').exists():
 sensitivity=read('reporting-only-sensitivity.json');assert sensitivity['paidRequests']==0 and sensitivity['registeredSensitivity']
 def reporting_accept(r):
  relaxed=reviews[r['name']].get('reportingOnlySensitivity') is True and r['manualCriteriaFailures']==['final_report_assigns_e2e_counts_to_unit_command']
  return all([r['officialRuntimeSuccess'],r['independentFunctionalSuccess'],r['agentRequiredChecksPassed'],r['noSolutionRetrieval'],r['manualBehaviorPassed'],r['auditedCompletion'] or relaxed,r['usage']['tokensCostReconciled']])
 assert sensitivity['relaxedTrials']==[r['name'] for r in rows if not r['auditedCompletion'] and reporting_accept(r)]
 for arm in protocol['arms']:assert sensitivity['acceptedCounts'][arm]==sum(r['arm']==arm and reporting_accept(r) for r in rows)
if (root/'resolved-project-sensitivity.json').exists():
 sensitivity=read('resolved-project-sensitivity.json');assert sensitivity['paidRequests']==0 and sensitivity['postSelectedSensitivity']
 def project_accept(r):
  relaxed=reviews[r['name']].get('resolvedProjectSensitivity') is True and r['manualCriteriaFailures']==['required_exact_npm_wrappers_not_invoked']
  return all([r['officialRuntimeSuccess'],r['independentFunctionalSuccess'],r['agentRequiredChecksPassed'] or relaxed,r['noSolutionRetrieval'],r['manualBehaviorPassed'],r['auditedCompletion'] or relaxed,r['usage']['tokensCostReconciled']])
 assert sensitivity['relaxedTrials']==[r['name'] for r in rows if not r['auditedCompletion'] and project_accept(r)]
 for arm in protocol['arms']:assert sensitivity['acceptedCounts'][arm]==sum(r['arm']==arm and project_accept(r) for r in rows)
 for c in sensitivity['comparisons']:
  pairs=[(a,b) for a in rows if a['arm']==c['left'] and project_accept(a) for b in rows if b['arm']==c['right'] and b['id']==a['id'] and b['repetition']==a['repetition'] and project_accept(b)]
  assert c['pairs']==len(pairs)
  for metric,fn in [('tokens',lambda r:r['usage']['input']+r['usage']['output']),('cost',lambda r:r['usage']['cost']),('seconds',lambda r:r['durationMs']/1000)]:
   left=sum(fn(a) for a,b in pairs);right=sum(fn(b) for a,b in pairs);resource=c['resources'][metric]
   assert close(resource['left'],left) and close(resource['right'],right)
   assert resource['relativeChange'] is None if not right else close(resource['relativeChange'],left/right-1)
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
  assert record['buildExitCode']==score['build']['exitCode']
  assert record['frozenPrivateProbeCount']==len([c for c in score['featureChecks'] if not c['name'].startswith('non-UTC:')])
  assert record['fullSuitesRepeated']==replay['fullSuitesRepeated']
  if replay['fullSuitesRepeated']:
   expected={k:score[k]['exitCode'] for k in ['types','full']+(['e2e'] if score.get('e2e') else [])}
   assert record['repeatedOriginalSuites']==expected
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
