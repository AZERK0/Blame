"""Verify public local presentation evidence; no model or recovered solution."""
import gzip,hashlib,json,re,sys
from pathlib import Path
root=Path(sys.argv[1]);f31=Path(sys.argv[2])
read=lambda p:json.loads(p.read_text())
sha=lambda b:hashlib.sha256(b).hexdigest()
length=lambda s:len(s.encode('utf-16-le',errors='surrogatepass'))//2
recorded=read(root/'recorded-replay.json');replayed=read(root/'public-replay.json')
assert recorded['paidRequests']==replayed['paidRequests']==0
assert not recorded['modelEfficacyMeasured'] and not replayed['modelEfficacyMeasured']
assert recorded['resultsSha256']==sha((f31/'results.json').read_bytes())
assert recorded['toolLedgerSha256']==sha((f31/'tool-ledger.json').read_bytes())
assert recorded['resultsSha256']==replayed['resultsSha256'] and recorded['toolLedgerSha256']==replayed['toolLedgerSha256']
results=read(f31/'results.json');ledger=read(f31/'tool-ledger.json');assert results['completed']==18
selected=[]
for trial in results['rows']:
 if trial['arm']=='cline':continue
 tools=next(r for r in ledger if r['name']==trial['name'])['tools']
 for index,t in enumerate(tools):
  if t['tool']!='run_task':continue
  d=t.get('output',{}).get('data') or {};d=d.get('completed',{}).get('data',d)
  if d.get('outputLog'):selected.append((trial,index,d))
assert len(selected)==len(recorded['rows'])==len(replayed['rows'])
pattern=re.compile(r'^(?:(?:#|ℹ)\s+(?:tests|suites|pass|fail|cancelled|skipped|todo)\s+\d+\b|(?:Test Suites|Tests|Snapshots):\s|\d+\s+(?:passing|failing|pending)\b|(?:PASS|FAIL):\s*\d)')
for (trial,index,d),row,again in zip(selected,recorded['rows'],replayed['rows']):
 assert {k:v for k,v in row.items() if k!='renderCpuMs'}=={k:v for k,v in again.items() if k!='renderCpuMs'}
 assert row['name']==trial['name'] and row['index']==index and row['pointer']==d['outputLog'] and row['eventsSha256']==trial['eventsSha256']
 if row.get('missing'):continue
 raw=gzip.decompress((root/row['artifact']).read_bytes());assert sha(raw)==row['rawSha256'] and len(raw)==row['rawBytes']
 observed={k:d.get(k) for k in ['check','reporting','validation']}
 assert sha(json.dumps(observed,ensure_ascii=False,separators=(',',':')).encode())==row['originalObservationSha256']
 detected=[]
 for number,text in enumerate(raw.decode().split('\n'),1):
  text=re.sub('\x1b\\[[0-9;]*m','',text).strip()
  if pattern.match(text):detected.append(dict(line=number,text=text))
 assert detected==row['detectedLines']
 before=row['baselineOutput'];after=row['candidateOutput'];assert before==d['output']
 maximum=4000 if d.get('failure') or d.get('paths') else 900;assert row['maximum']==maximum
 c=(d.get('check')or{}).get('counts');caption=''
 if (d.get('check')or{}).get('evidenceOrigin')=='node_events' and c:
  caption=f"\nActive Node case results: {c['passed']} passed, {c['failed']} failed, {c['skipped']} skipped/todo. File workers and suites are excluded. Command outcome: {d['check']['outcome']}. Test scope, selection and freshness are not admitted by these counts."
 assert length(after)<=(1200 if length(raw.decode())<=1200 else maximum)+length(caption)
 visible=lambda output:[line for line in detected if line['text'] in re.sub('\x1b\\[[0-9;]*m','',output)]
 assert visible(before)==row['baselineVisible'] and visible(after)==row['candidateVisible']
 assert row['gainedLines']==[l for l in visible(after) if l not in visible(before)]
 assert row['lostLines']==[l for l in visible(before) if l not in visible(after)]
 for arm,output in [('baseline',before),('candidate',after)]:
  assert length(output)==row[arm+'Characters'] and len(output.encode())==row[arm+'Bytes']
 assert row['changed']==(before!=after)
rows=[r for r in recorded['rows'] if not r.get('missing')];totals=recorded['totals']
assert totals['selectedPointers']==len(selected) and totals['missingLogs']==len(selected)-len(rows)
for key in ['detectedLines','baselineVisible','candidateVisible','gainedLines','lostLines']:
 assert totals[key]==sum(len(r[key]) for r in rows)
for key in ['baselineCharacters','candidateCharacters','baselineBytes','candidateBytes']:
 assert totals[key]==sum(r[key] for r in rows)
assert totals['changedLogs']==sum(r['changed'] for r in rows)
assert totals['renderCpuMs']['repetitions']==50
for arm in ['baseline','candidate']:
 assert all(r['renderCpuMs']['repetitions']==50 and r['renderCpuMs'][arm]>=0 for r in rows)
 assert abs(totals['renderCpuMs'][arm]-sum(r['renderCpuMs'][arm] for r in rows))<1e-8
controls=read(root/'local-controls.json');assert controls['paidRequests']==0
assert controls['candidatePatchSha256']==sha((root/'candidate.patch').read_bytes())
assert controls['testSourceSha256']==sha(Path(__file__).with_name('validation-summary.test.ts').read_bytes())
assert controls['changedModules']==['harness/light-task-runner.js','harness/validation-output.js']
left=controls['moduleBindings']['baseline'];right=controls['moduleBindings']['candidate'];assert left.keys()==right.keys()
assert sorted(k for k in left if left[k]!=right[k])==controls['changedModules']
for arm,expected in [('baseline',1),('candidate',0)]:
 r=next(r for r in controls['rows'] if r['arm']==arm);assert r['exitCode']==expected
 assert re.search(r'ℹ tests 8\b',r['stdout']) and re.search(r'ℹ fail '+('6' if arm=='baseline' else '0')+r'\b',r['stdout'])
candidate=read(root/'production-checks.json');assert candidate['paidRequests']==0 and all(r['exitCode']==0 for r in candidate['rows'])
for binding in candidate['bindings']:assert binding['actual']==binding['expected']==right[binding['path']]
if (root/'rollback-checks.json').exists():
 rollback=read(root/'rollback-checks.json');assert rollback['paidRequests']==0 and rollback['experimentalTestAbsent']
 assert all(r['exitCode']==0 for r in rollback['rows'])
 for binding in rollback['sourceBindings']:assert binding['actual']==binding['expected']
 for binding in rollback['moduleBindings']:assert binding['actual']==binding['expected']==left[binding['path']]
if (root/'decision.json').exists():
 decision=read(root/'decision.json')
 assert decision['decision']=='keep-experimental-revert-production-integration' and not decision['currentProductionIncludesPrototype'] and not decision['modelEfficacyMeasured']
 assert decision['measured']==recorded['totals'] and decision['productionRollbackCommit']==rollback['commit']
print(json.dumps(dict(paidRequests=0,verifiedLogs=len(rows),missingLogs=totals['missingLogs'],baselineVisible=totals['baselineVisible'],candidateVisible=totals['candidateVisible'],gainedLines=totals['gainedLines'],lostLines=totals['lostLines'],localControlsVerified=True,limitation='Public byte/presentation replay,not model adoption,independent source review or billed-token measurement.'),indent=2))
