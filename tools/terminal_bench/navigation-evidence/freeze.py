from pathlib import Path
import json,shutil,subprocess,sys,os,re
repo=Path(__file__).resolve().parents[3];panel,arm=sys.argv[1:3];assert panel in ('f18','f19','f20','f21','f22','f23') and arm in ('baseline','modified')
variant=os.environ.get('BLAME_STUDY_VARIANT','');assert not variant or re.fullmatch(r'[a-z0-9][a-z0-9-]{0,40}',variant)
root=repo/('.blame/research/navigation-evidence'+('-'+variant if variant else ''))/'frozen'/panel/arm;assert not root.exists(),'Never overwrite frozen runtime'
source=Path(sys.argv[3]) if len(sys.argv)>3 else repo/'packages/agent-runtime/dist'
for package in ('agent-runtime','benchmark-runner'):
 target=root/package;target.mkdir(parents=True);shutil.copytree(source if package=='agent-runtime' else repo/'packages/benchmark-runner/dist',target/'dist')
 (target/'package.json').write_text('{"type":"module","exports":"./dist/index.js"}\n')
 if package=='agent-runtime':(target/'node_modules').symlink_to(repo/'packages/agent-runtime/node_modules',target_is_directory=True)
 else:
  (target/'node_modules/@blame').mkdir(parents=True);(target/'node_modules/@blame/agent-runtime').symlink_to(root/'agent-runtime',target_is_directory=True)
metadata={'buildCheckoutCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),'runtimeCommit':sys.argv[4] if len(sys.argv)>4 else subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),'sourceDirectory':str(source),'sourcePatch':subprocess.check_output(['git','diff','HEAD','--','packages/agent-runtime/src','packages/benchmark-runner/src'],cwd=repo,text=True)}
if len(sys.argv)>5:
 override=json.loads(Path(sys.argv[5]).read_text())
 metadata['sourceOverride' if override.get('kind') else 'commonSourcePatch']=override
(root/'version.json').write_text(json.dumps(metadata,indent=2)+'\n')
