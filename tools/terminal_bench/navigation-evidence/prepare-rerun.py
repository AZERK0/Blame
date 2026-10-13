"""Build immutable historical arms with the same explicit request-cap patch.

No model calls. Never modifies historical freezes or model workspaces.
"""
import hashlib,json,os,subprocess,sys
from pathlib import Path

repo=Path(__file__).resolve().parents[3]
variant=os.environ.get('BLAME_STUDY_VARIANT')
assert variant=='budget050', 'Use the registered budget050 rerun'
study=repo/'docs/experiments/light-harness-navigation-evidence-budget050-2026-10-13'
work=repo/'.blame/research/navigation-evidence-budget050'
patch=(study/'common-request-cap.patch').read_bytes()
sha=lambda data:hashlib.sha256(data).hexdigest()
config=json.loads((study/'protocol.json').read_text())
def call(argv,**kwargs):
    subprocess.run(argv,cwd=repo,check=True,**kwargs)
for commit in sorted({v for arms in config['sourceVersions'].values() for v in arms.values()}):
    source=work/'sources'/commit
    assert not source.exists(), 'Never overwrite source checkpoints'
    source.mkdir(parents=True)
    archive=subprocess.check_output(['git','archive',commit,'packages/agent-runtime'],cwd=repo)
    call(['tar','-xf','-','-C',str(source)],input=archive)
    production=source/'packages/agent-runtime/src/production.ts'
    before=sha(production.read_bytes())
    subprocess.run(['patch','--batch','-p1'],cwd=source,input=patch,check=True)
    (source/'packages/agent-runtime/node_modules').symlink_to(repo/'packages/agent-runtime/node_modules',target_is_directory=True)
    call(['node','node_modules/typescript/bin/tsc','-p',str(source/'packages/agent-runtime/tsconfig.json')])
    call(['node',str(source/'packages/agent-runtime/scripts/copy-prompt.mjs')])
    binding={'baseCommit':commit,'baseTree':subprocess.check_output(['git','rev-parse',commit+'^{tree}'],cwd=repo,text=True).strip(),
             'sourceArchiveSha256':sha(archive),'patchFile':str((study/'common-request-cap.patch').relative_to(repo)),
             'patchSha256':sha(patch),'productionBeforeSha256':before,'productionAfterSha256':sha(production.read_bytes()),
             'method':'Only the common per-request output-cap production patch; feature source and prompts unchanged.'}
    (source/'common-patch-binding.json').write_text(json.dumps(binding,indent=2)+'\n')
for panel,arms in config['sourceVersions'].items():
    for arm,commit in arms.items():
        source=work/'sources'/commit
        call(['python','tools/terminal_bench/navigation-evidence/freeze.py',panel,arm,
              str(source/'packages/agent-runtime/dist'),commit,str(source/'common-patch-binding.json')])
print(json.dumps({'panels':len(config['sourceVersions']),'commonPatchSha256':sha(patch),'paidRequests':0}))
