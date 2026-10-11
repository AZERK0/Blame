#!/usr/bin/env python3
"""Run the separately budgeted, immutable real-project and layout panels once."""
import hashlib
import json
import os
import subprocess
from pathlib import Path

repository = Path(__file__).resolve().parents[3]
os.chdir(repository)
study = Path("docs/experiments/light-harness-large-project-2026-10-11")
work = Path(".blame/research/large-project")


def tree_digest(path):
    digest = hashlib.sha256()
    for file in sorted(
        (file for file in path.rglob("*") if file.is_file()), key=str
    ):
        digest.update(("/" + file.relative_to(path).as_posix() + "\0").encode())
        digest.update(file.read_bytes())
    return digest.hexdigest()


assert not (work / "pilot").exists()
assert not (work / "layout-diagnostic/pilot").exists()
for name, expected in [
    ("BLAME_MODEL_ID", "gpt-5.6-luna"),
    ("BLAME_REASONING_EFFORT", "high"),
    ("BLAME_PROVIDER_ID", "openai-codex"),
    ("BLAME_API_URL", "https://api.blame.so/api/v1"),
]:
    assert os.environ.get(name) == expected, name
assert os.environ.get("BLAME_API_TOKEN")
with (work / "run.log").open("w") as log:
    result = subprocess.run(
        ["node", "tools/terminal_bench/large-project/run.mjs", "run"],
        env={**os.environ, "NODE_USE_ENV_PROXY": "1", "TZ": "UTC"},
        stdout=log,
        stderr=subprocess.STDOUT,
    )
if result.returncode:
    raise SystemExit("Real-project panel stopped; preserve all started trials.")
print("Real-project panel completed or hit its registered observed guard.", flush=True)

panel = "layout-diagnostic"
binding = json.loads((study / panel / "execution-bindings.json").read_text())
for name, expected in binding["fileSha256"].items():
    assert hashlib.sha256(Path(name).read_bytes()).hexdigest() == expected, name
assert hashlib.sha256((study / panel / "protocol.json").read_bytes()).hexdigest() == binding["protocolSha256"]
assert tree_digest(Path("tools/terminal_bench/corpus-noop-confirmation/fixture")) == binding["fixtureSha256"]
for arm, expected in binding["versions"].items():
    frozen = work / panel / "frozen" / arm
    assert tree_digest(frozen / "agent-runtime/dist") == expected["runtimeSha256"]
    assert tree_digest(frozen / "benchmark-runner/dist") == expected["runnerSha256"]
    assert json.loads((frozen / "version.json").read_text()) == expected["source"]
environment = {
    **os.environ,
    "BLAME_STUDY_DIRECTORY": str((study / panel).resolve()),
    "BLAME_STUDY_WORK_DIRECTORY": str((work / panel).resolve()),
    "NODE_USE_ENV_PROXY": "1",
    "TZ": "UTC",
}
with (work / panel / "run.log").open("w") as log:
    result = subprocess.run(
        ["node", "tools/terminal_bench/corpus-noop-confirmation/light-study.mjs", "run"],
        env=environment,
        stdout=log,
        stderr=subprocess.STDOUT,
    )
if result.returncode:
    raise SystemExit("Layout panel stopped; preserve all started/unexecuted trials.")
print("Registered layout diagnostic completed.", flush=True)
