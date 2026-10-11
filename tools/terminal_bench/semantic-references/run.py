"""Run the registered frozen real-project diagnostic once using the existing CLI."""
import os
from pathlib import Path
import subprocess

repo = Path(__file__).resolve().parents[3]
os.chdir(repo)
work = Path(".blame/research/semantic-references")
assert not (work / "pilot").exists(), "Retain prior campaigns; never overwrite results"
assert os.environ.get("BLAME_API_TOKEN"), "Model credential not configured"
with (work / "run.log").open("w") as log:
    result = subprocess.run(
        ["node", "tools/terminal_bench/semantic-references/run.mjs", "run"],
        env={**os.environ, "NODE_USE_ENV_PROXY": "1", "TZ": "UTC"},
        stdout=log, stderr=subprocess.STDOUT,
    )
raise SystemExit(result.returncode)
