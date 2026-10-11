# Current Light versus Serena

Architecture comparison and a preselected local TypeScript diagnostic, October 11, 2026. **No model benchmark or global efficiency claim.** Light is frozen at `963c6952f7f9b2f4ab0a5abb2e48eac7f6973fe2`; Serena at `1de556f71569f3acfc0743e526dd60aca40a545e` (`2.0.0.dev0`). This comparison changes no production code.

Serena is an MCP augmentation for an existing agent. Light supplies navigation, guarded edits, task execution and completion contracts inside Blame. Compare their overlapping mechanisms separately from responsibilities supplied by Serena's host.

| Mechanism | Current Light | Frozen Serena |
| --- | --- | --- |
| Code structure | AST symbols, outlines, bodies, ranges; raw fallback | Language-server symbols, bodies, optional type/hover information; alternatively JetBrains analysis |
| References | Explicit `lexical_fallback`; names are candidates | LSP identity across files, import aliases and declarations; capabilities depend on server and project configuration |
| Refactoring | Symbol edits and multi-file patches; no native semantic rename | Native LSP rename and reference-aware deletion; JetBrains additionally offers move/inline and wider dependency/type navigation |
| Edit freshness | Observation coverage and content identity required; conflicting external source blocks the edit | LSP editor resolves the current symbol; inspected replacement path has no equivalent prior-observation identity check |
| Multi-file effects | Planned writes, expected source/preimages, pending journal and recovery for cooperating harness operations | LSP workspace edits are converted to operations and applied sequentially; this inspection does not prove crash atomicity or assess JetBrains transactions |
| Validation | Actual task invocations, source-bound technical evidence and `finish_task` admission; technical verification is separate from user acceptance | Explicit LSP diagnostic tools; host owns tests and completion. Automatic per-edit diagnostics are disabled by default in the inspected LSP editing base class |
| Context/tool surface | Five primitives, bounded navigation, source-bound memory | Configurable tools/contexts and optional progressive-disclosure Python REPL; memories and caches. Counting all optional tools as inevitable prompt overhead would be incorrect |
| Environment | Parser availability/unsupported fallbacks; managed process inspection, cancellation and timeouts | Language-server installation, initialization, indexing and persistent caches; optional paid JetBrains plugin/IDE |

Immutable upstream evidence: [symbol tools](https://github.com/oraios/serena/blob/1de556f71569f3acfc0743e526dd60aca40a545e/src/serena/tools/symbol_tools.py), [LSP editing](https://github.com/oraios/serena/blob/1de556f71569f3acfc0743e526dd60aca40a545e/src/serena/code_editor.py#L398), [diagnostics default](https://github.com/oraios/serena/blob/1de556f71569f3acfc0743e526dd60aca40a545e/src/serena/tools/tools_base.py#L433), [Codex context](https://github.com/oraios/serena/blob/1de556f71569f3acfc0743e526dd60aca40a545e/src/serena/resources/config/contexts/codex.yml), [interfaces](https://github.com/oraios/serena/blob/1de556f71569f3acfc0743e526dd60aca40a545e/src/serena/config/serena_config.py#L221), [backend differences](https://github.com/oraios/serena/blob/1de556f71569f3acfc0743e526dd60aca40a545e/README.md#programming-language-support--semantic-analysis-capabilities). Corresponding Light paths: `light-navigation.ts`, `light-aliases.ts`, `light-edit.ts`, `light-commit.ts`, `light-task-runner.ts`, `finish-task.ts`, `project-memory.ts` under `packages/agent-runtime/src/harness`.

## Observed local results

The three-file fixture and expected identities were registered before calls. An exported `calculate` is imported as `compute`; another module contains an unrelated `calculate`, string and comment.

- Serena returns three reference entries on two expected consumer lines (two positions on the import and the aliased call), with no unrelated module. It falls back to grouping these references at file level, repeating the import context; preserve this presentation limitation.
- Light returns six lexical candidates, including unrelated names/literal/comment; the aliased call is absent. These are **candidates**, not a promise of semantic references.
- Serena's native rename updates the definition and import, preserves `compute` and all unrelated bytes. A Light batch produces identical source using **human-selected patch targets**; this does not establish native rename or model discovery capability.
- After a correct body read and an external `+1` to `+99` change, Light blocks replacement and preserves the external source. Serena, explicitly synchronized with the filesystem, returns `OK` and applies the requested `*2` replacement. This demonstrates different freshness contracts, not a violation of Serena's unconditional replacement contract. A client can add its own read/conflict policy.
- Both arms pass real TypeScript 5.9.3 `strict`, `noEmit`, `NodeNext` checks after rename and stale-edit handling: **four compiler invocations, four zero exits**. Compilation does not detect lost external intent. The analyzer checks 11 source/result properties, all passing.

The first Light run inherited the enclosing Git repository's ignored `.blame` path and returned no search candidates. Both original ledgers remain archived; `setup-correction.json` registers the isolated Git-root correction before the repeated calls. Source, queries, expected identities and production remain unchanged. Do not treat that preparation failure as a language-reference comparison.

Tool-output UTF-8 bytes and individual durations are recorded, including Serena's initial instructions. They are not provider tokens, cache consumption, model cost, or a controlled timing benchmark. Setup and indexing must be charged in a future cold/warm comparison. Model calls/cost: **0 / $0**; billed/cache tokens: **not applicable**, represented as null. JetBrains was not executed. No timeout or tool exception occurred in either isolated arm.

## Evaluation boundaries and decision

Serena's [published evaluations](https://github.com/oraios/serena/blob/1de556f71569f3acfc0743e526dd60aca40a545e/docs/04-evaluation/030_results/000_evaluation-results.md) all use **JetBrains**. Its [method](https://github.com/oraios/serena/blob/1de556f71569f3acfc0743e526dd60aca40a545e/docs/04-evaluation/010_methodology.md) measures useful workflows/payloads, includes neutral/adverse applicable cases, but lets the executing agent choose concrete tasks and assess them. The [prompt](https://github.com/oraios/serena/blob/1de556f71569f3acfc0743e526dd60aca40a545e/docs/04-evaluation/020_prompts/010_evaluation-prompt.md) excludes misuse and silent-failure traps. This answers a different question from task-success campaigns retaining every failure. Neither those reports nor this fixture rank Serena against Blame/Cline on audited success or reconciled total resources. Historical Blame/Cline campaigns remain separate.

**Investigate**, rather than replace the harness: expose an optional read-only semantic reference provider through `search_code`, keeping engine/project/completeness labels and lexical fallback. Preserve Light's guarded commit and validation contracts. A subsequent semantic-rename planner would need to feed expected-source edits through that commit path, rather than bypass it with direct MCP writes; that intervention is not implemented here.

Next confirmation should preselect larger real-project tasks requiring aliased cross-file changes, overloads/re-exports, and negative controls (small local/configuration changes and incomplete projects). First compare Light versus Light plus semantic **queries only**, freezing model, effort, prompts, schemas, server/compiler, project graph, tasks and budgets. Cline and Cline plus Serena LSP are useful additional host-controlled arms; Serena itself is not an autonomous agent arm. The existing runner has not been extended or used for these arms here. Keep diagnostics separate from unseen confirmation, all failures/timeouts and missing usage, and distinguish actual/passing checks, admitted verification and audited user criteria. Include setup, cold/warm indexing, tool schemas, retries, provider tokens/cache, prices and wall time. More dependencies, incomplete project graphs, misleading reference completeness, schema overhead and startup latency are explicit regression risks.

## Reproduce

Use a built Light checkout at the frozen commit and an independent checkout of Serena at the pinned SHA. Read upstream `AGENTS.md` and its referenced memories. Install Serena with `uv sync --frozen --no-dev` (recorded successful, 180-second outer budget). Use its `.venv/bin/python` for the driver. Preserve inherited proxy/environment; set only a disposable `SERENA_HOME`. For exact npm runtime dependencies, copy the archived `serena-runtime-package-lock.json` to `$SERENA_HOME/language_servers/static/TypeScriptLanguageServer/ts-lsp/package-lock.json`, create its `package.json` from the lock's root package, and run `npm ci` there before the replay. Installed versions here are TypeScript 5.9.3 and typescript-language-server 5.1.3; Serena's own Python lock is bound by its upstream commit and `bindings.json`.

Write reproduction outputs outside this committed evidence directory. Both drivers create an independent Git root and source fixture; the Python driver calls `initial_instructions` before code tools. Each arm is bounded by a 90-second parent watchdog; compiler subprocesses have 20-second limits. Example from the Blame root, with `SERENA_HOME` already set and `UPSTREAM` pointing to the frozen checkout:

```sh
STUDY=docs/experiments/light-harness-serena-comparison-2026-10-11
OUTPUT=$(mktemp -d)
timeout 90 node tools/terminal_bench/corpus/light-study-serena-light.mjs "$PWD" "$STUDY/fixture.json" "$OUTPUT/light-root" "$OUTPUT/light-ledger.json"
timeout 90 "$UPSTREAM/.venv/bin/python" tools/terminal_bench/corpus/light-study-serena.py --repo "$PWD" --fixture "$STUDY/fixture.json" --root "$OUTPUT/serena-root" --output "$OUTPUT/serena-ledger.json"
cp "$STUDY/fixture.json" "$OUTPUT/fixture.json"
python tools/terminal_bench/corpus/light-study-serena-analyze.py "$OUTPUT"
```

`protocol.json`, `fixture.json` and `bindings.json` were saved before initial calls; `setup-correction.json` before the isolated replay. `runtime.json` records resolved dependency versions. Ledgers retain all returned results and source snapshots, including the first setup failure. `results.json` is derived directly by the analyzer; `inventory.json` binds the archived evidence. Byte counts omit transport envelopes and are never reported as billed tokens.
