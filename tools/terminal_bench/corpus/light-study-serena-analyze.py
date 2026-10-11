"""Audit preserved local tool outputs; no inference about model task success."""
import hashlib
import json
from pathlib import Path
import re
import sys

directory = Path(sys.argv[1])
fixture = json.loads((directory / "fixture.json").read_text())
arms = {arm: json.loads((directory / (arm + "-ledger.json")).read_text()) for arm in ("light", "serena")}
report = {"type": "Local deterministic mechanism diagnostic, not a model benchmark",
          "modelCalls": 0, "modelCostUsd": 0, "billedTokens": None, "cacheTokens": None,
          "jetBrainsExecuted": False, "arms": {}, "checks": {}}
for arm, ledger in arms.items():
    initial = {path: hashlib.sha256(text.encode()).hexdigest()
               for path, text in ledger["sources"]["initial"].items()}
    report["checks"][arm + "InitialSourceMatchesRegistration"] = initial == fixture["sourceSha256"]
    after = ledger["sources"].get("afterRename", {})
    expected = dict(fixture["files"])
    for path in ("src/original.ts", "src/consumer.ts"):
        expected[path] = expected[path].replace("calculate", "evaluate", 1)
    report["checks"][arm + "RenameSourceMatchesExpected"] = after == expected
    report["checks"][arm + "AllRecordedCompilerChecksPass"] = (
        len(ledger["compiler"]) == 2 and all(c["exitCode"] == 0 for c in ledger["compiler"]))
    report["checks"][arm + "NoRuntimeError"] = not ledger.get("error")
    report["arms"][arm] = {"totalToolCalls": len(ledger["calls"]),
        "compiler": ledger["compiler"], "error": ledger.get("error"),
        "bytesPerCall": [{"name": c["name"], "resultBytes": c["resultBytes"]} for c in ledger["calls"]],
        "finalSourceSha256": {p: hashlib.sha256(t.encode()).hexdigest()
                              for p, t in ledger["sources"].get("afterStaleEdit", {}).items()}}

light_search = next(c["result"] for c in arms["light"]["calls"] if c["name"] == "search_code")["data"]
report["arms"]["light"]["references"] = {
    "engine": light_search["engine"], "returnedCandidates": len(light_search["results"]),
    "locations": [{"path": hit["path"], "lines": hit["lines"]} for hit in light_search["results"]],
    "interpretation": "Lexical candidates, not asserted semantic references; aliased consumer call absent, unrelated homonyms/literal/comment present."}
serena_refs = json.loads(next(c["result"] for c in arms["serena"]["calls"] if c["name"] == "find_referencing_symbols"))
locations = set()
entries = 0
for path, groups in serena_refs.items():
    for references in groups.values():
        for reference in references:
            entries += 1
            for line in re.findall(r">\s*(\d+):", reference["content_around_reference"]):
                locations.add((path, int(line) + 1))  # Serena snippets use zero-based lines.
expected_locations = {(c["path"], c["line"]) for c in fixture["semanticReferences"]}
report["checks"]["SerenaUniqueReferenceLinesMatchRegisteredIdentity"] = locations == expected_locations
report["arms"]["serena"]["references"] = {
    "returnedEntries": entries, "uniqueLines": [{"path": p, "line": n} for p, n in sorted(locations)],
    "interpretation": "Three LSP locations displayed as file-level groups: two import positions repeat one line, and the aliased call is on the second line. No unrelated-file group."}
light_final = arms["light"]["sources"].get("afterStaleEdit", {}).get("src/original.ts")
serena_final = arms["serena"]["sources"].get("afterStaleEdit", {}).get("src/original.ts")
report["checks"]["LightStaleBodyEditBlockedAndExternalSourcePreserved"] = (
    arms["light"]["calls"][-1]["result"]["status"] == "blocked" and
    light_final == arms["light"]["sources"]["externalChange"]["src/original.ts"])
report["checks"]["SerenaAppliedRequestedReplacementWithoutObservationFreshnessGuard"] = (
    arms["serena"]["calls"][-1]["result"] == "OK" and serena_final is not None and "return n * 2" in serena_final)
report["limitations"] = [
    "Tiny preselected TypeScript fixture; mechanism evidence cannot establish population success, tokens, cost or duration.",
    "Light rename uses human-selected patches. Its success does not demonstrate native semantic rename or model discovery.",
    "Serena LSP only, with explicit external filesystem synchronization; no JetBrains, transport/client behavior or crash-atomicity test.",
    "Serena reference grouping fell back to the whole consumer file and repeated its import line; retain raw output.",
    "Compiler success proves type correctness here, not preservation of external intent or fulfillment of user criteria.",
    "First parent-repository runs are preserved separately; Light initial search had zero candidates from inherited Git exclusions.",
    "Returned UTF-8 bytes and single-call timings are diagnostics; no provider request, billed-token, cache or price comparison."]
report["decision"] = "Investigate a read-only semantic-reference provider behind search_code; keep guarded Light edits and validation. Defer semantic rename integration and any superiority claim pending confirmation on real tasks."
(directory / "results.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({"checks": report["checks"], "allChecksPass": all(report["checks"].values())}, indent=2))
raise SystemExit(0 if all(report["checks"].values()) else 1)
