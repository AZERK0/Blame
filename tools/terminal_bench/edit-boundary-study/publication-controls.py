"""Local publication fault controls. No model requests or source/oracle execution."""
import gzip, hashlib, json, subprocess, sys, tempfile
from pathlib import Path

study=Path(sys.argv[1]).resolve()
verifier=Path(__file__).with_name('verify-public.py').resolve()

def replay(root):
 return subprocess.run([sys.executable,str(verifier),str(root)],capture_output=True,text=True)

assert replay(study).returncode==0,'Valid public replay failed'
cases=[]
with tempfile.TemporaryDirectory(prefix='blame-publication-controls-') as directory:
 # Share immutable inputs by symlink; each fault writes a new local file.
 root=Path(directory)
 for path in study.iterdir(): (root/path.name).symlink_to(path,target_is_directory=path.is_dir())
 def put(name,value):
  path=root/name
  if path.is_symlink():path.unlink()
  path.write_text(json.dumps(value,indent=2)+'\n')
 def restore(name):
  path=root/name
  path.unlink();path.symlink_to(study/name)
 def rejected(name):
  result=replay(root);assert result.returncode!=0,name+' was silently accepted'
  cases.append({'fault':name,'rejected':True})
 review=json.loads((study/'source-review.json').read_text())
 accepted=next(d for d in review['decisions'] if d['fullRequestCriteriaPassed'] and d['agentRequiredChecksPassed'])
 accepted['noSolutionRetrieval']=False
 put('source-review.json',review);rejected('Changed manual acceptance without corresponding outcome');restore('source-review.json')
 results=json.loads((study/'results.json').read_text());results['rows'][0]['usage']['cost']+=0.01
 put('results.json',results);rejected('Changed observed cost inconsistent with original usage events');restore('results.json')
 summary=json.loads((study/'guidance-summary.json').read_text())
 comparison=next(c for c in summary['comparisons'] if c['pairs'])
 comparison['resources']['tokens']['left']+=1
 put('guidance-summary.json',summary);rejected('Changed paired resource subtotal');restore('guidance-summary.json')
 summary=json.loads((study/'guidance-summary.json').read_text());summary['accounting']['accountedUsd']+=0.01
 put('guidance-summary.json',summary);rejected('Changed financial reserve/subtotal');restore('guidance-summary.json')
 review=json.loads((study/'source-review.json').read_text())
 behavioral=next((r for r in review['decisions'] if isinstance(r.get('manualBehaviorPassed'),bool)),None)
 if behavioral is not None:
  behavioral['manualBehaviorPassed']=not behavioral['manualBehaviorPassed']
  put('source-review.json',review);rejected('Changed audited behavior inconsistent with recorded criteria');restore('source-review.json')
 provenance=json.loads((study/'validation-provenance.json').read_text())
 call=next(c for row in provenance['rows'] for c in row['actualRecordedAgentCommands'] if c['recordedSourceBinding'])
 call['recordedSourceBinding']['completed']='fabricated-source-revision'
 put('validation-provenance.json',provenance);rejected('Rebound an actual invocation to another source');restore('validation-provenance.json')
 provenance=json.loads((study/'validation-provenance.json').read_text())
 call=next(c for row in provenance['rows'] for c in row['actualRecordedAgentCommands'] if c['reporting'] and c['reporting']['counts']['pending'] is None)
 call['reporting']['counts']['pending']=0
 put('validation-provenance.json',provenance);rejected('Promoted an unreported validation counter to zero');restore('validation-provenance.json')
 if (study/'failure-classification.json').exists():
  classification=json.loads((study/'failure-classification.json').read_text())
  failed=next(r for r in classification['rows'] if not r['official'])
  failed['mechanism']='fabricated-cause'
  put('failure-classification.json',classification);rejected('Changed original runtime failure attribution');restore('failure-classification.json')
 if (study/'final-scope-only-sensitivity.json').exists():
  sensitivity=json.loads((study/'final-scope-only-sensitivity.json').read_text())
  sensitivity['resources']['tokens']['left']+=1
  put('final-scope-only-sensitivity.json',sensitivity);rejected('Changed final-scope-only sensitivity resource subtotal');restore('final-scope-only-sensitivity.json')
 if (study/'reporting-only-sensitivity.json').exists():
  sensitivity=json.loads((study/'reporting-only-sensitivity.json').read_text())
  sensitivity['acceptedCounts']['cline']+=1
  put('reporting-only-sensitivity.json',sensitivity);rejected('Changed reporting-only sensitivity subtotal');restore('reporting-only-sensitivity.json')
 if (study/'resolved-project-sensitivity.json').exists():
  sensitivity=json.loads((study/'resolved-project-sensitivity.json').read_text())
  sensitivity['acceptedCounts']['baseline']+=1
  put('resolved-project-sensitivity.json',sensitivity);rejected('Changed resolved-project sensitivity subtotal');restore('resolved-project-sensitivity.json')
 if (study/'behavior-public-replay.json').exists():
  behavior=json.loads((study/'behavior-public-replay.json').read_text())
  behavior['rows'][0]['sourceUnchangedByReplay']=False
  put('behavior-public-replay.json',behavior);rejected('Changed source reconstruction provenance');restore('behavior-public-replay.json')
 wire=json.loads(gzip.decompress((study/'wire-contracts.json.gz').read_bytes()))
 wire['trials'][0]['requests'][0]['model']='unregistered-model'
 # Rehash metadata and outer archive: fixed settings must still reject it.
 trial=wire['trials'][0]
 serial=lambda value:json.dumps(value,ensure_ascii=False,separators=(',',':')).encode()
 trial['metadataSha256']=hashlib.sha256(b''.join(serial(q)+b'\n' for q in trial['requests'])).hexdigest()
 path=root/'wire-contracts.json.gz';path.unlink();payload=gzip.compress(serial(wire),mtime=0);path.write_bytes(payload)
 inventory=json.loads((study/'wire-inventory.json').read_text());inventory['sha256']=hashlib.sha256(payload).hexdigest()
 put('wire-inventory.json',inventory);rejected('Rehashed wire metadata with unregistered model')

print(json.dumps({'paidRequests':0,'validReplayPassed':True,'negativeControls':cases,
 'limitation':'Checks accidental corruption/inconsistent accounting, not cryptographic signing, model independence or a new adjudication of manual decisions.'},indent=2))
