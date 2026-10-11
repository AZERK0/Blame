#!/usr/bin/env python3
"""Run only after the separately audited T6 diagnostic meets its fixed gate."""
import json
import os
import subprocess
from pathlib import Path
repository = Path(__file__).resolve().parents[3]
os.chdir(repository)
decision = json.loads(Path("docs/experiments/light-harness-manifest-reading-2026-10-11/decision.json").read_text())
assert decision["decision"] == "retain", "Registered confirmation remains unexecuted after a failed diagnostic gate"
work = Path(".blame/research/manifest-reading-confirmation")
assert not (work / "pilot").exists()
with (work / "run.log").open("w") as log:
    result = subprocess.run(
        ["node", "tools/terminal_bench/manifest-reading-confirmation/run.mjs", "run"],
        env={**os.environ, "NODE_USE_ENV_PROXY": "1", "TZ": "UTC"},
        stdout=log, stderr=subprocess.STDOUT,
    )
raise SystemExit(result.returncode)
