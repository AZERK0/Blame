# F9: semantic references with Light effect contracts

The Serena comparison identified a concrete identity gap: lexical search cannot follow an import alias or distinguish unrelated homonyms. F9 adds a **read-only TypeScript language-service backend** to the existing `search_code` primitive. It uses the already installed TypeScript 5.9.3 dependency, without Serena code, a Python runtime, an external LSP server or new production dependencies. Symbol navigation, edit planning, observation requirements, command supervision and completion admission remain in Light.

## Implemented contract

```json
{"mode":"references","query":"src/original.ts#calculate"}
```

A symbol `sN` alias also works. A bare name remains a lexical candidate search; a homonym is never silently chosen. Supported targets are JS/TS declarations in a configured `tsconfig.json` or `jsconfig.json` project. The nearest ancestor configuration within the workspace defines the compiler graph. Scope filters displayed references, not the compiler's project inputs.

Results identify `typescript_language_service`, target, source revision, project configuration/version/counts, scoped reference count, output limits and project warnings. The target definition is excluded. Missing imports/project references are labeled partial; even a warning-free configured project is not a claim to find all workspace, dependency, dynamic or runtime callers. The results say `navigationOnly`: they provide neither compiler-pass evidence nor edit coverage. Native semantic rename is not part of F9.

Each request runs a new disposable worker: 8-second worker deadline, 512 MiB old-generation limit, 2,000 root files, 6,000 observed reads, 30,000 observed existence checks and 64 MiB read budget. Cancellation terminates the worker. Exact source/configuration/library/package reads and positive/negative file lookups are rechecked before returning results, followed by a workspace revision check. No persistent compiler cache is introduced. Missing configuration, unsupported targets, worker failure/timeout and budget excess expose an explicit `semanticFallback` with lexical candidates. Invalid or ambiguous symbol addresses retain the existing blocked-input behavior.

Reference snippets and containing-symbol aliases are bounded to eight returned source lines. They do not authorize replacing the enclosing body; `read_code` remains required. The runtime archive explicitly ships the worker entry point and executes it in a packaged end-to-end test. TypeScript and its compiler libraries already belonged to that archive.

## Local evidence

The original Serena three-file fixture is reused unchanged. Bare `calculate` searches remain lexical in both arms. The new explicit target query returns precisely the expected import and aliased-call lines, excluding unrelated homonym/literal/comment candidates. Both versions preserve an external source change by blocking a stale edit. Baseline's unsupported path-qualified reference query is retained as such; this is a new capability, not an equal-contract precision score against its lexical results.

On pinned date-fns `313b902b9a72c64501074db9bc2b9897d2db5140`, fresh workers load 1,519 root files and 2,057 compiler files, finding 26 timezone-helper and 41 rounding-helper reference lines. Output remains limited to eight. Final recorded fresh-worker queries take roughly 3.3–3.5 seconds on a warm filesystem; these single observations are **not a controlled latency gain**. Repeated graph construction is a material cost to investigate separately. An initial prototype incorrectly classified ambient Node imports as unresolved; the implementation now recognizes the compiler's ambient modules. Do not interpret its earlier warning/timing as current behavior.

Current validation: 16 dedicated identity/freshness/scope/cancellation controls, 193 combined focused runtime tests, and three packaged-runtime tests pass; runtime compilation and changed-module ESLint pass. The upstream baseline compiler and requested five existing test files pass (127 tests, one skip). New controls cover method/re-export identity, JavaScript, Unicode/BOM offsets, missing/invalid configuration, graph changes, incomplete projects, output truncation and unseen/stale edit protection. No local result establishes global model success or token/cost savings.

## Registered real-project diagnostic

`protocol.json` fixes three requests before implementation/results: two internal helper renames and a local parameter-rename control. `protocol-original.json` and `protocol-amendment.json` preserve a pre-model clarification: the helpers have direct test imports, so mechanical test binding updates must be allowed while assertions/cases stay intact. Function/import/call names must use the new identifier, existing aliases stay intact, and other nontrivia tokens cannot change. This explicit criterion avoids treating an otherwise valid newly introduced alias as a silent verifier failure.

The independent verifier uses lexical token equivalence, not the reference backend under study. Original checkout hashes, permitted paths, real compiler/test invocations and final trace/source review are separate gates. Its controls reject unchanged tasks and unrelated additions and accept the requested mechanical rename. The baseline is built from an isolated exact `0b50d10c` checkout; incomplete setup snapshots are kept outside the frozen arms. The candidate differs by F9 only in production behavior. Local setup/build fixes are not task successes or model trials.

Reuse the existing headless benchmark CLI and accounting through `tools/terminal_bench/semantic-references/run.mjs`. Its model/budget/environment/ordering/versions are frozen before `run`: Blame reference, Blame F9 and Cline SDK 0.0.82, GPT-5.6-Luna/high, one repetition, nine planned trials, 24 iterations, 480 seconds, $0.05 SDK limit per trial and $0.30 panel ceiling. A new trial reserves its full configured limit; missing cost is conservatively reserved, not replaced with zero. These are known diagnostics, not unseen confirmation. Retain every failure/timeout and missing consumption, inspect actual route exposure and requested final checks, and report official versus audited completion independently. Requested checks include both helper tests; the grader also executes the full existing suite.

Reproduce local tool output with `node tools/terminal_bench/semantic-references/replay.mjs` after building the runtime and freezing an exact baseline under `.blame/research/semantic-references/frozen/baseline`. The model driver provides `bind`, `run`, `analyze` and `score`; `run.py` starts it once with configured credentials and refuses prior campaign overwrite. Never rerun into committed evidence or reset a failed trial. No published solution or source recovery is used for model scoring.

## Decision and next intervention

Keep F9 if the guarded local mechanisms remain correct; an optional useful query does not prove a global efficiency improvement. The next evidence-driven step is either cheaper source-bound repeated queries or a semantic rename planner routed through existing observed-source/preimage/commit safeguards. Measure either separately, including cold graph cost, partial configuration and concurrent-source controls. Extend other languages through a backend adapter only after equivalent contracts and confirmation exist. Task tests, admitted verification and user acceptance remain distinct throughout.
