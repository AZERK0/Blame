"""Freeze reference runtime saved before edits and candidate, with one common runner."""
from pathlib import Path
import json,shutil,subprocess,sys
repo=Path(__file__).resolve().parents[3]
arm=sys.argv[1]
assert arm in ('baseline','modified')
root=repo/'.blame/research/npm-observation-confirmation/frozen'/arm
assert not root.exists(), 'Never overwrite a frozen arm'
for package in ('agent-runtime','benchmark-runner'):
    target=root/package;target.mkdir(parents=True)
    source=repo/'packages'/package/'dist'
    if arm=='baseline' and package=='agent-runtime':
        source=repo/'.blame/research/required-validation/f16-reference-source/packages/agent-runtime/dist'
    shutil.copytree(source,target/'dist')
    (target/'package.json').write_text('{"type":"module","exports":"./dist/index.js"}\n')
    if package=='agent-runtime':
        (target/'node_modules').symlink_to(repo/'packages/agent-runtime/node_modules',target_is_directory=True)
    else:
        (target/'node_modules/@blame').mkdir(parents=True)
        (target/'node_modules/@blame/agent-runtime').symlink_to(root/'agent-runtime',target_is_directory=True)
(root/'version.json').write_text(json.dumps({
    'commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),
    'runtimeCommit':'c42da0340a7743adc1a124dae4d498b04d769e72' if arm=='baseline' else subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),
    'sourcePatch':subprocess.check_output(['git','diff','HEAD','--','packages/agent-runtime/src','packages/benchmark-runner/src'],cwd=repo,text=True),
    'runner':'Identical metadata transport and F15 required-check contract/briefing in both arms. F17 changes only declared runner attribution; user instructions and tool schemas are identical.'
},indent=2)+'\n')
