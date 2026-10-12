"""Freeze reference runtime saved before edits and candidate, with one common runner."""
from pathlib import Path
import json,shutil,subprocess,sys
repo=Path(__file__).resolve().parents[3]
arm=sys.argv[1]
assert arm in ('baseline','modified')
root=repo/'.blame/research/required-validation/frozen'/arm
assert not root.exists(), 'Never overwrite a frozen arm'
for package in ('agent-runtime','benchmark-runner'):
    target=root/package;target.mkdir(parents=True)
    source=repo/'packages'/package/'dist'
    if arm=='baseline' and package=='agent-runtime':
        source=repo/'.blame/research/required-validation/reference-runtime/dist'
    shutil.copytree(source,target/'dist')
    (target/'package.json').write_text('{"type":"module","exports":"./dist/index.js"}\n')
    if package=='agent-runtime':
        (target/'node_modules').symlink_to(repo/'packages/agent-runtime/node_modules',target_is_directory=True)
    else:
        (target/'node_modules/@blame').mkdir(parents=True)
        (target/'node_modules/@blame/agent-runtime').symlink_to(root/'agent-runtime',target_is_directory=True)
(root/'version.json').write_text(json.dumps({
    'commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),
    'runtimeCommit':'d08138cd8a711cfa7afd965a37eabed885191a51' if arm=='baseline' else subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),
    'sourcePatch':subprocess.check_output(['git','diff','HEAD','--','packages/agent-runtime/src','packages/benchmark-runner/src'],cwd=repo,text=True),
    'runner':'Identical newly built metadata transport in both arms; older reference ignores requiredChecks. No model-facing user prompt differences.'
},indent=2)+'\n')
