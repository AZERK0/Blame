#!/usr/bin/env python3
"""Uniform post-selection audit; never replace registered scores or repair source."""
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

pilot, destination = map(Path, sys.argv[1:3])
rows = json.loads((pilot / "analysis.json").read_text())["rows"]
reviews = json.loads((pilot / "source-review.json").read_text())["decisions"]
tsx = Path(".blame/research/large-project/date-fns/node_modules/tsx/dist/cli.mjs").resolve()
verifier = Path("tools/terminal_bench/large-project/wording-sensitivity.ts").resolve()
output = []
for row in rows:
    score = json.loads((pilot / row["name"] / "score.json").read_text())
    review = next(review for review in reviews if review["name"] == row["name"])
    checks, invocations = [], []
    if row["id"] == "shared-day-millis":
        for zone in ["UTC", "America/New_York"]:
            argv = ["node", str(tsx), str(verifier), str((pilot / row["name"] / "workspace").resolve())]
            result = subprocess.run(argv, env={**os.environ, "TZ": zone}, capture_output=True, text=True, timeout=10)
            invocations.append({"argv": argv, "timezone": zone, "exitCode": result.returncode,
                                "stdout": result.stdout, "stderr": result.stderr})
            if result.returncode == 0:
                checks.extend(json.loads(result.stdout)["checks"])
        # Keep every original non-padding check, including delegation and existing tests.
        non_padding = [check for check in score["featureChecks"]
                       if check["name"].split(":")[-1] != "JJJJJJJJJJ"]
        functional = (len(checks) == 48 and all(check["passed"] for check in checks)
                      and all(check["passed"] for check in non_padding)
                      and all(score[key]["exitCode"] == 0 for key in ["selected", "types", "full"])
                      and not score["unexpectedPaths"])
    else:
        functional = row["independentFunctionalSuccess"]
    for path, digest in score["sourceSha256"].items():
        assert hashlib.sha256((pilot / row["name"] / "workspace" / path).read_bytes()).hexdigest() == digest
    criteria = (functional and review["fullRequestCriteriaPassed"]
                and review["agentRequiredChecksPassed"] and review["noSolutionRetrieval"])
    output.append({"name": row["name"], "arm": row["arm"], "id": row["id"],
                   "eventsSha256": row["eventsSha256"], "diffSha256": row["diffSha256"],
                   "scoreSha256": row["scoreSha256"], "wordingFunctionalSuccess": functional,
                   "wordingAuditedCriteria": criteria,
                   "wordingAuditedCompletion": criteria and row["status"] == "succeeded",
                   "checks": checks, "invocations": invocations})
result = {"selectedAfterTraceInspection": True,
          "reason": 'Registered verifier requires exactly eight digits for ten J characters; frozen request says "at least eight". Uniform minimum-width audit retains original scores and all cases, without source repair or verifier feedback.',
          "verifierSha256": hashlib.sha256(verifier.read_bytes()).hexdigest(),
          "rows": output}
destination.write_text(json.dumps(result, indent=2) + "\n")
published = destination.parent
original = json.loads((published / "results.json").read_text())
secondary = published / "wording-sensitivity"
secondary.mkdir(exist_ok=True)
for row in original["rows"]:
    sensitivity = next(item for item in output if item["name"] == row["name"])
    row["registeredAuditedCompletion"] = row["auditedCompletion"]
    row["auditedSuccess"] = sensitivity["wordingAuditedCompletion"]
    row["auditedCompletion"] = sensitivity["wordingAuditedCompletion"]
original["endpoint"] = "Exploratory post-selected minimum-eight wording sensitivity, not the registered T5 endpoint."
(secondary / "results.json").write_text(json.dumps(original, indent=2) + "\n")
subprocess.run(["node", "tools/terminal_bench/corpus/light-study-compare.mjs", str(secondary)],
               check=True, stdout=subprocess.DEVNULL)
result["summary"] = {
    arm: {"trials": sum(row["arm"] == arm for row in output),
          "wordingFunctionalSuccess": sum(row["arm"] == arm and row["wordingFunctionalSuccess"] for row in output),
          "wordingAuditedCompletion": sum(row["arm"] == arm and row["wordingAuditedCompletion"] for row in output)}
    for arm in ["baseline", "modified", "cline"]
}
destination.write_text(json.dumps(result, indent=2) + "\n")
