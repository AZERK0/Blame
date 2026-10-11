#!/usr/bin/env python3
"""Show effective model inputs, full source changes and bounded command diagnostics."""
import hashlib
import json
import sys
from pathlib import Path

campaign = Path(sys.argv[1])
selected = set(sys.argv[2:])
analysis = json.loads((campaign / "analysis.json").read_text())
ledger = json.loads((campaign / "tool-ledger.json").read_text())
for row in analysis["rows"]:
    if row["name"] not in selected:
        continue
    directory = campaign / row["name"]
    print("\nTRIAL", row["name"], "RUNTIME", row["status"], "FUNCTIONAL", row["independentFunctionalSuccess"])
    for index, tool in enumerate(next(item["tools"] for item in ledger if item["name"] == row["name"])):
        inputs = tool["input"]
        effective = {"commands": inputs.get("commands")} if tool["tool"] == "run_commands" else inputs
        print("INPUT", index, tool["tool"], json.dumps(effective, ensure_ascii=False))
        if tool["tool"] == "run_commands":
            print("INERT EXTRA KEYS", [
                {"preview": key[:100], "bytes": len(key.encode()),
                 "keySha256": hashlib.sha256(key.encode()).hexdigest()}
                for key in inputs if key != "commands"
            ])
        output = tool.get("output")
        if tool["tool"] in ["apply_patch", "run_commands"]:
            if isinstance(output, list):
                print("OUTPUT", [(item.get("success"), item.get("result", "")[-1600:]) for item in output])
            else:
                print("OUTPUT", output)
        elif tool["tool"] in ["run_task", "edit_code"]:
            if output.get("status") != "ok":
                print("OUTPUT", output)
            else:
                data = output.get("data", {})
                print("OUTPUT", {key: value for key, value in data.items() if key in [
                    "command", "exitCode", "validation", "changed", "changes", "parse", "guidance", "status", "runId",
                ]})
                if data.get("output"):
                    print("COMMAND TEXT", data["output"][-1600:])
    print("FULL DIFF", (directory / "workspace.diff").read_text())
    score = json.loads((directory / "score.json").read_text())
    print("GRADER", {key: score[key] for key in ["independentFunctionalSuccess", "unexpectedPaths", "sourceSha256"]})
    print("FEATURE FAILURES", [check for check in score["featureChecks"] if not check["passed"]])
