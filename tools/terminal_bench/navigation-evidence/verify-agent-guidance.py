"""Replay public local-control assertions and byte hashes; no model or npm needed."""
import gzip
import hashlib
import json
from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
manifest = json.loads((root / "validation.json").read_text())
for item in manifest["artifacts"]:
    content = (root / item["path"]).read_bytes()
    assert hashlib.sha256(content).hexdigest() == item["sha256"], item["path"]
controls = json.loads((root / "controls.json").read_text())
before, after = controls["variants"]
assert before["label"] == "before" and after["label"] == "after"
assert len(before["scopes"]) == len(after["scopes"]) == 7
for old, new in zip(before["scopes"], after["scopes"]):
    assert old["input"] == new["input"]
    assert old["output"]["results"] == new["output"]["results"] == []
    assert "nextSearch" not in old["output"]
    assert new["output"]["scopeStatus"] == "empty"
    assert new["recoveryResultCount"] > 0
assert before["references"]["engine"] == after["references"]["engine"] == "lexical_fallback"
assert len(after["references"]["nextSearches"]) == 2
assert before["rename"]["fileHashes"] == after["rename"]["fileHashes"]
receipt = after["rename"]["output"]["semanticRename"]
assert receipt["identifierEdits"] == sum(row["identifierEdits"] for row in receipt["editsByFile"]) == 3
assert any("as compute" in row["before"] and "updatedCalculation as compute" in row["after"] for row in receipt["examples"])
for variant in [before, after]:
    assert variant["reading"]["output"]["contentBytes"] == 64000
    assert variant["reading"]["unseenEditStatus"] == "blocked"
    assert variant["patches"]["unchanged"]
assert before["reading"]["output"]["contentSha256"] == after["reading"]["output"]["contentSha256"]
assert after["reading"]["output"]["nextRead"]["range"]["startLine"] > 1
assert len(after["validation"]) == len(before["validation"]) == 7
for old, new in zip(before["validation"], after["validation"]):
    assert old["outputSha256"] == new["outputSha256"]
    assert "reportedCounts" not in old["observation"]
    assert new["observation"]["reportedCounts"]["skipped"] is None
    assert new["observation"]["selection"] == new["observation"]["freshness"] == "unknown"
recovery = after["patches"]["output"]["recovery"]
assert json.loads(recovery[recovery.index("{"):])["patchCorrection"]["reason"] == "multiple_files_for_symbol"
for label, expected in [("before", (21, 3, 18, 0)), ("after", (21, 21, 0, 0)), ("final-regressions", (95, 95, 0, 0))]:
    text = gzip.decompress((root / f"{label}.tap.gz").read_bytes()).decode()
    actual = tuple(int(re.search(rf"^# {field} (\d+)$", text, re.M)[1]) for field in ["tests", "pass", "fail", "skipped"])
    assert actual == expected, (label, actual)
text = gzip.decompress((root / "full-runtime.tap.gz").read_bytes()).decode()
totals = {field: int(re.search(rf"^# {field} (\d+)$", text, re.M)[1]) for field in ["tests", "pass", "fail", "skipped"]}
assert totals["fail"] == 0 and totals["tests"] == totals["pass"] + totals["skipped"]
assert totals == manifest["fullRuntime"]
assert manifest["modelRequests"] == 0
print(json.dumps({"verified": True, "artifacts": len(manifest["artifacts"]), "targeted": "21/21", "parent": "3/21", "regressions": "95/95", "fullRuntime": totals, "modelRequests": 0}))
