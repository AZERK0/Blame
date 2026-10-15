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
