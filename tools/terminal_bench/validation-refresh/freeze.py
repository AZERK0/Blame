"""Freeze built runtime and runner; dependency and shared-core hashes are bound separately."""
from pathlib import Path
import json,shutil,subprocess,sys
repo=Path(__file__).resolve().parents[3]
arm=sys.argv[1]
assert arm in ('baseline','modified')
root=repo/'.blame/research/validation-refresh/frozen'/arm
assert not root.exists(), 'Never overwrite a frozen arm'
for package in ('agent-runtime','benchmark-runner'):
 target=root/package;target.mkdir(parents=True)
 shutil.copytree(repo/'packages'/package/'dist',target/'dist')
 (target/'package.json').write_text('{"type":"module","exports":"./dist/index.js"}\n')
 if package=='agent-runtime': (target/'node_modules').symlink_to(repo/'packages/agent-runtime/node_modules',target_is_directory=True)
 else:
  (target/'node_modules/@blame').mkdir(parents=True)
  (target/'node_modules/@blame/agent-runtime').symlink_to(root/'agent-runtime',target_is_directory=True)
(root/'version.json').write_text(json.dumps({'commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),'sourcePatch':subprocess.check_output(['git','diff','HEAD','--','packages/agent-runtime/src'],cwd=repo,text=True)},indent=2)+'\n')
