#!/usr/bin/env python3
"""Run all preregistered T4 panels sequentially, verifying immutable inputs."""
import datetime,hashlib,json,os,subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[3]
os.chdir(root)
study=Path('docs/experiments/light-harness-edit-noops-2026-10-11')
work=Path('.blame/research/edit-noops')
bindings=json.loads((study/'execution-bindings.json').read_text())
def digest(path):
 h=hashlib.sha256()
 for f in sorted((f for f in path.rglob('*') if f.is_file()),key=lambda f:str(f)):
  h.update(('/'+f.relative_to(path).as_posix()+'\0').encode());h.update(f.read_bytes())
 return h.hexdigest()
for panel in ['canary','global','confirmation']:
 for name,expected in bindings['fileSha256'].items():
  assert hashlib.sha256(Path(name).read_bytes()).hexdigest()==expected,name
 for name,value in [('BLAME_MODEL_ID','gpt-5.6-luna'),('BLAME_REASONING_EFFORT','high'),('BLAME_PROVIDER_ID','openai-codex'),('BLAME_API_URL','https://api.blame.so/api/v1')]:
  assert os.environ.get(name)==value,name
 assert os.environ.get('BLAME_API_TOKEN')
 assert not (work/panel/'pilot').exists(),'Refuse rerunning/replacing a started panel'
 expected=bindings['panels'][panel]
 assert hashlib.sha256((study/panel/'protocol.json').read_bytes()).hexdigest()==expected['protocolSha256']
 for arm,version in expected['versions'].items():
  frozen=work/panel/'frozen'/arm
  assert digest(frozen/'agent-runtime/dist')==version['runtimeSha256'],(panel,arm,'runtime')
  assert digest(frozen/'benchmark-runner/dist')==version['runnerSha256'],(panel,arm,'runner')
  assert json.loads((frozen/'version.json').read_text())==version['source']
 check={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'freshPanelModelTrialsStarted':0,'allBoundSourcesVersionsProtocolsMatch':True,'panel':panel,'bindingsSha256':hashlib.sha256((study/'execution-bindings.json').read_bytes()).hexdigest(),'launcherSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'modelEffortProviderApiMatch':True,'credentialPresent':True,'credentialValueRecorded':False}
 (study/panel/'pre-execution-check.json').write_text(json.dumps(check,indent=2)+'\n')
 env={**os.environ,'BLAME_STUDY_DIRECTORY':str((study/panel).resolve()),'BLAME_STUDY_WORK_DIRECTORY':str((work/panel).resolve()),'NODE_USE_ENV_PROXY':'1'}
 driver='tools/terminal_bench/corpus-noop-confirmation/light-study.mjs' if panel=='confirmation' else 'tools/terminal_bench/corpus/light-study.mjs'
 print('Starting registered '+panel+' with verified frozen inputs.',flush=True)
 with (work/panel/'run.log').open('w') as log:
  result=subprocess.run(['node',driver,'run'],env=env,stdout=log,stderr=subprocess.STDOUT)
 if result.returncode:
  raise SystemExit('Panel '+panel+' stopped with code '+str(result.returncode)+'. Preserve failures, missing usage and unexecuted trials; no replacement.')
 print('Completed registered '+panel+'.',flush=True)
