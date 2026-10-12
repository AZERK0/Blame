"""Run a registered panel once with the configured model through the existing CLI."""
import os,subprocess,sys
from pathlib import Path
repo=Path(__file__).resolve().parents[3];os.chdir(repo)
panel='diagnostic'
work=Path('.blame/research/command-wait')
assert not (work/panel).exists(), 'Never overwrite model trials'
assert os.environ.get('BLAME_API_TOKEN'), 'Configured credential missing'
with (work/(panel+'-run.log')).open('w') as log:
 result=subprocess.run(['node','tools/terminal_bench/command-wait/run.mjs','run',panel],env={**os.environ,'NODE_USE_ENV_PROXY':'1','TZ':'UTC'},stdout=log,stderr=subprocess.STDOUT)
raise SystemExit(result.returncode)
