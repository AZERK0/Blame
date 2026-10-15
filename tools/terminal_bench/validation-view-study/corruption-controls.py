"""Reject four public presentation/accounting corruptions in a disposable copy."""
import gzip,json,shutil,subprocess,sys,tempfile
from pathlib import Path
study=Path(sys.argv[1]).resolve();f31=Path(sys.argv[2]).resolve();script=Path(__file__).with_name('verify-replay.py')
with tempfile.TemporaryDirectory(prefix='f32-publication-controls-') as directory:
 root=Path(directory)/'study';shutil.copytree(study,root)
 def check():return subprocess.run([sys.executable,str(script),str(root),str(f31)],capture_output=True).returncode
 assert check()==0;cases=[]
 def put(name,data):(root/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
 def reject(name):assert check()!=0,name;cases.append(dict(fault=name,rejected=True))
 data=json.loads((root/'recorded-replay.json').read_text());data['totals']['candidateVisible']+=1;put('recorded-replay.json',data)
 reject('Changed visible-summary subtotal');shutil.copyfile(study/'recorded-replay.json',root/'recorded-replay.json')
 for name in ['recorded-replay.json','public-replay.json']:
  data=json.loads((root/name).read_text());next(r for r in data['rows'] if not r.get('missing'))['originalObservationSha256']='0'*64;put(name,data)
 reject('Rebound original validation observation in both projections')
 for name in ['recorded-replay.json','public-replay.json']:shutil.copyfile(study/name,root/name)
 data=json.loads((root/'recorded-replay.json').read_text());row=next(r for r in data['rows'] if not r.get('missing'));artifact=root/row['artifact'];artifact.write_bytes(gzip.compress(b'fabricated validation log'))
 reject('Changed archived raw validation bytes');shutil.copyfile(study/row['artifact'],artifact)
 data['modelEfficacyMeasured']=True;put('recorded-replay.json',data)
 reject('Promoted local evidence to a model efficacy measurement')
 shutil.copyfile(study/'recorded-replay.json',root/'recorded-replay.json')
 if (root/'rollback-checks.json').exists():
  data=json.loads((root/'rollback-checks.json').read_text());data['moduleBindings'][0]['actual']='0'*64;put('rollback-checks.json',data)
  reject('Changed restored production module binding')
 print(json.dumps(dict(paidRequests=0,validReplayPassed=True,negativeControls=cases,limitation='Accidental-corruption controls; not cryptographic signing or an independent model/source audit.'),indent=2))
