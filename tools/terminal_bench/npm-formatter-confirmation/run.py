#!/usr/bin/env python3
"""Run the distinct F6 panel only while its preselected new requests remain unexposed."""
import json, os, subprocess
from pathlib import Path
repository=Path(__file__).resolve().parents[3]
os.chdir(repository)
decision=json.loads(Path("docs/experiments/light-harness-manifest-reading-2026-10-11/decision.json").read_text())
assert decision["decision"] in ["retire","deepen"], "F6 contingency requires the failed T6 gate"
assert not Path(".blame/research/manifest-reading-confirmation/pilot").exists(), "Tasks already exposed"
work=Path(".blame/research/npm-formatter-confirmation")
assert not (work/"pilot").exists()
with (work/"run.log").open("w") as log:
 result=subprocess.run(["node","tools/terminal_bench/npm-formatter-confirmation/run.mjs","run"],env={**os.environ,"NODE_USE_ENV_PROXY":"1","TZ":"UTC"},stdout=log,stderr=subprocess.STDOUT)
raise SystemExit(result.returncode)
