"""Verify archived raw bytes, additive sources, journals and dependency inputs without a model."""
import base64,gzip,hashlib,json,sys
from pathlib import Path
root=Path(sys.argv[1])
sha=lambda b:hashlib.sha256(b).hexdigest()
raw=json.loads((root/'inventory.json').read_text())
for item in raw:
 if item.get('missing'):continue
 data=gzip.decompress((root/item['artifact']).read_bytes())
 assert len(data)==item['bytes'] and sha(data)==item['sha256'],item['artifact']
supp=json.loads((root/'supplemental-inventory.json').read_text())
assert sha((root/supp['artifact']).read_bytes())==supp['sha256']
sources=json.loads(gzip.decompress((root/supp['artifact']).read_bytes()))['sources']
for item in sources:
 if item.get('missing'):continue
 data=base64.b64decode(item['content']);assert len(data)==item['bytes'] and sha(data)==item['sha256']
 score=json.loads(gzip.decompress((root/'traces'/f"{item['name']}.score.json.gz").read_bytes()))
 assert score['sourceSha256'][item['path']]==item['sha256']
for item in supp.get('journals',[]):
 data=gzip.decompress((root/item['artifact']).read_bytes());assert len(data)==item['bytes'] and sha(data)==item['sha256']
env=root/'environment-inventory.json'
if env.exists():
 for item in json.loads(env.read_text())['files']:
  data=gzip.decompress((root/item['artifact']).read_bytes());assert len(data)==item['bytes'] and sha(data)==item['sha256']
results=(root/'results.json').read_bytes();checks=json.loads((root/'checks.json').read_text());assert sha(results)==checks['resultsSha256']
print(json.dumps({'study':str(root),'rawVerified':sum(not i.get('missing') for i in raw),'addedSourcesVerified':len(sources),'journalsVerified':len(supp.get('journals',[])),'resultsSha256Verified':True}))
