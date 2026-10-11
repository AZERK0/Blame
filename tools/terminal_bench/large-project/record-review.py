#!/usr/bin/env python3
"""Record an explicit human-readable supervising-agent decision after inspection."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("campaign", type=Path)
parser.add_argument("name")
parser.add_argument("--checks", choices=["passed", "failed"], required=True)
parser.add_argument("--criteria", choices=["passed", "failed"], required=True)
parser.add_argument("--retrieval", choices=["absent", "present"], required=True)
parser.add_argument("--notes", required=True)
args = parser.parse_args()
file = args.campaign / "source-review.json"
review = json.loads(file.read_text()) if file.exists() else {
    "method": "Unblinded inspection of every effective recorded tool input, command results and complete final source diff. Inert native JSON keys are retained separately. No source repair, gold recovery or verifier feedback.",
    "decisions": [],
}
assert not any(decision["name"] == args.name for decision in review["decisions"])
row = next(row for row in json.loads((args.campaign / "analysis.json").read_text())["rows"] if row["name"] == args.name)
decision = {"name": args.name, "review": "reviewed", "agentRequiredChecksPassed": args.checks == "passed",
    "fullRequestCriteriaPassed": args.criteria == "passed", "noSolutionRetrieval": args.retrieval == "absent",
    "notes": args.notes}
for name, field in [("events.jsonl", "eventsSha256"), ("workspace.diff", "diffSha256"), ("score.json", "scoreSha256")]:
    decision[field] = hashlib.sha256((args.campaign / args.name / name).read_bytes()).hexdigest()
    assert decision[field] == row[field]
review["decisions"].append(decision)
review["updatedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
file.write_text(json.dumps(review, indent=2) + "\n")
