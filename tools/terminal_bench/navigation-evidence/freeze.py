from pathlib import Path
import json,shutil,subprocess,sys
repo=Path(__file__).resolve().parents[3];panel,arm=sys.argv[1:3];assert panel in ('f18','f19','f20') and arm in ('baseline','modified')
root=repo/'.blame/research/navigation-evidence/frozen'/panel/arm;assert not root.exists(),'Never overwrite frozen runtime'
source=Path(sys.argv[3]) if len(sys.argv)>3 else repo/'packages/agent-runtime/dist'
for package in ('agent-runtime','benchmark-runner'):
 target=root/package;target.mkdir(parents=True);shutil.copytree(source if package=='agent-runtime' else repo/'packages/benchmark-runner/dist',target/'dist')
 (target/'package.json').write_text('{"type":"module","exports":"./dist/index.js"}\n')
 if package=='agent-runtime':(target/'node_modules').symlink_to(repo/'packages/agent-runtime/node_modules',target_is_directory=True)
 else:
  (target/'node_modules/@blame').mkdir(parents=True);(target/'node_modules/@blame/agent-runtime').symlink_to(root/'agent-runtime',target_is_directory=True)
(root/'version.json').write_text(json.dumps({'buildCheckoutCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),'runtimeCommit':sys.argv[4] if len(sys.argv)>4 else subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),'sourceDirectory':str(source),'sourcePatch':subprocess.check_output(['git','diff','HEAD','--','packages/agent-runtime/src','packages/benchmark-runner/src'],cwd=repo,text=True)},indent=2)+'\n')
