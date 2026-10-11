"""Invoke frozen Serena tools on a registered fixture; no model, no upstream edits.

Run with the frozen upstream's uv-managed Python environment. SERENA_HOME must
point to a disposable, isolated cache. A parent process enforces the 90s budget;
the ledger is flushed after each returned call, including errors.
"""
import argparse
import hashlib
import json
import logging
from pathlib import Path
import subprocess
import time


def main():
    parser = argparse.ArgumentParser()
    for name in ("repo", "fixture", "root", "output"):
        parser.add_argument("--" + name, required=True, type=Path)
    args = parser.parse_args()
    fixture = json.loads(args.fixture.read_text())
    root = args.root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    for path, text in fixture["files"].items():
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
    (root / "package.json").write_text(json.dumps({"type": "module"}))
    (root / "tsconfig.json").write_text(json.dumps({"compilerOptions": {
        "strict": True, "noEmit": True, "target": "ES2022", "module": "NodeNext",
        "moduleResolution": "NodeNext", "types": [], "skipLibCheck": False},
        "include": ["src/**/*.ts"]}))
    (root / ".serena").mkdir(exist_ok=True)
    (root / ".serena/project.yml").write_text(
        'project_name: "serena-comparison"\nlanguage_servers: ["typescript"]\n'
        'ignore_all_files_in_gitignore: false\n')
    (root / ".gitignore").write_text(".blame/\n.serena/\n")
    subprocess.run(["git", "init", "--quiet", str(root)], check=True)
    ledger = {"arm": "Serena LSP", "modelCalls": 0, "calls": [], "compiler": [], "sources": {}}

    def save():
        args.output.write_text(json.dumps(ledger, indent=2) + "\n")

    def snapshot():
        return {path: (root / path).read_text() for path in fixture["files"]}

    def call(name, **inputs):
        start = time.perf_counter()
        result = agent.get_tool_by_name(name).apply_ex(log_call=False, **inputs)
        ledger["calls"].append({"name": name, "input": inputs, "result": result,
                                "resultBytes": len(result.encode()),
                                "elapsedMs": (time.perf_counter() - start) * 1000})
        save()
        return result

    def compile_sources(phase):
        start = time.perf_counter()
        result = subprocess.run(["node", str(args.repo.resolve() /
            "packages/agent-runtime/node_modules/typescript/bin/tsc"), "-p", str(root / "tsconfig.json")],
            cwd=root, text=True, capture_output=True, timeout=20)
        ledger["compiler"].append({"phase": phase, "exitCode": result.returncode,
                                   "stdout": result.stdout, "stderr": result.stderr,
                                   "elapsedMs": (time.perf_counter() - start) * 1000})
        save()

    ledger["sources"]["initial"] = snapshot()
    ledger["sourceHashesInitial"] = {path: hashlib.sha256(text.encode()).hexdigest()
                                    for path, text in ledger["sources"]["initial"].items()}
    save()
    agent = None
    try:
        from serena.agent import SerenaAgent
        from serena.config.serena_config import SerenaConfig, ModeSelectionDefinition
        config = SerenaConfig(log_level=logging.WARNING).with_headless_mode_overrides()
        ledger["configuration"] = {"headless": True, "context": "default", "interface": "tools",
                                   "baseModes": list(config.base_modes or []), "defaultModes": ["benchmark"],
                                   "toolTimeoutSeconds": config.tool_timeout,
                                   "maxAnswerChars": config.default_max_tool_answer_chars}
        save()
        start = time.perf_counter()
        agent = SerenaAgent(project=str(root), serena_config=config,
                            modes=ModeSelectionDefinition(default_modes=["benchmark"]))
        agent.execute_task(lambda: None, name="wait-for-language-server")
        ledger["initializationMs"] = (time.perf_counter() - start) * 1000
        ledger["activeTools"] = sorted(agent.get_active_tool_names())
        save()
        call("initial_instructions")
        call("find_symbol", name_path_pattern="calculate", relative_path="src/original.ts", include_body=True)
        call("find_referencing_symbols", name_path="calculate", relative_path="src/original.ts")
        call("rename_symbol", name_path="calculate", relative_path="src/original.ts", new_name="evaluate")
        ledger["sources"]["afterRename"] = snapshot()
        compile_sources("afterRename")
        call("find_symbol", name_path_pattern="evaluate", relative_path="src/original.ts", include_body=True)
        (root / "src/original.ts").write_text(
            ledger["sources"]["afterRename"]["src/original.ts"].replace("return n + 1", "return n + 99"))
        ledger["sources"]["externalChange"] = snapshot()
        # Explicit synchronization gives the LSP current source before editing.
        # It supplies no new body read to a model (there is no model in this replay).
        ledger["externalSyncFiles"] = agent.get_active_project_or_raise().ls_sync_file_system_changes()
        save()
        call("replace_symbol_body", name_path="evaluate", relative_path="src/original.ts",
             body="export function evaluate(n: number): number { return n * 2; }")
        ledger["sources"]["afterStaleEdit"] = snapshot()
        compile_sources("afterStaleEdit")
    except Exception as error:
        ledger["error"] = {"name": type(error).__name__, "message": str(error)}
    finally:
        save()
        if agent is not None:
            agent.on_shutdown()
    print(json.dumps({"arm": ledger["arm"], "calls": len(ledger["calls"]),
                      "compiler": [item["exitCode"] for item in ledger["compiler"]], "error": ledger.get("error")}))
    return 1 if ledger.get("error") else 0


if __name__ == "__main__":
    raise SystemExit(main())
