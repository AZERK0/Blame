import os,subprocess,sys
from pathlib import Path
repo=Path(__file__).resolve().parents[3];os.chdir(repo)
panel=sys.argv[1];assert panel in ('f18','f19','f20')
work=Path('.blame/research/navigation-evidence');assert not (work/panel).exists(),'Never overwrite trials'
assert os.environ.get('BLAME_API_TOKEN'),'Configured credential unavailable'
with (work/(panel+'-run.log')).open('w') as log:
 r=subprocess.run(['node','tools/terminal_bench/navigation-evidence/run.mjs','run',panel],env={**os.environ,'NODE_USE_ENV_PROXY':'1','TZ':'UTC'},stdout=log,stderr=subprocess.STDOUT)
raise SystemExit(r.returncode)
