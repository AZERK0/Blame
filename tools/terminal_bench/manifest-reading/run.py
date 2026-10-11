#!/usr/bin/env python3
"""Run the separately registered T6 diagnostic once; driver checks bound inputs."""
import os
import subprocess
from pathlib import Path
repository = Path(__file__).resolve().parents[3]
os.chdir(repository)
work = Path(".blame/research/manifest-reading")
assert not (work / "pilot").exists()
with (work / "run.log").open("w") as log:
    result = subprocess.run(
        ["node", "tools/terminal_bench/manifest-reading/run.mjs", "run"],
        env={**os.environ, "NODE_USE_ENV_PROXY": "1", "TZ": "UTC"},
        stdout=log, stderr=subprocess.STDOUT,
    )
raise SystemExit(result.returncode)
