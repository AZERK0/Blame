"""Archive pinned source and all inputs read by upstream tests,without solutions."""
import subprocess,gzip,hashlib,json
from pathlib import Path
repo=Path(__file__).resolve().parents[3]
work=repo/'.blame/research/edit-boundaries-f31'
study=repo/'docs/experiments/light-harness-edit-boundaries-f31-2026-10-16'
rows=[]
for project in ['yaml','fast-glob']:
 root=work/'upstreams'/project;archive=work/(project+'-source.tar')
 archive.write_bytes(subprocess.check_output(['git','archive','HEAD'],cwd=root))
 submodules={}
 if project=='yaml':
  for name,paths in [('yaml-test-suite',['src']),('json-test-suite',['test_parsing','test_transform'])]:
   sub=root/'tests'/name
   submodules['tests/'+name]={'commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=sub).decode().strip(),'testInputPaths':paths}
   fragment=work/(name+'.tar')
   fragment.write_bytes(subprocess.check_output(['git','archive','--prefix=tests/'+name+'/','HEAD',*paths],cwd=sub))
   subprocess.run(['tar','--concatenate','--file='+str(archive),str(fragment)],check=True)
 payload=gzip.compress(archive.read_bytes(),mtime=0)
 (study/'preparation'/(project+'-source.tar.gz')).write_bytes(payload)
 lock=(root/'package-lock.json').read_bytes()
 (study/'preparation'/(project+'-package-lock.json.gz')).write_bytes(gzip.compress(lock,mtime=0))
 rows.append({'project':project,'commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root).decode().strip(),'submodules':submodules,'archiveSha256':hashlib.sha256(payload).hexdigest(),'uncompressedArchiveSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'lockSha256':hashlib.sha256(lock).hexdigest()})
(study/'upstreams.json').write_text(json.dumps(rows,indent=2)+'\n')
print(json.dumps({'archived':len(rows),'paidRequests':0}))
