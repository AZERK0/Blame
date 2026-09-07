# Terminal Bench headless runner

Blame can run as a development-only installed Harbor agent without Electron or the desktop renderer. Each trial starts one `BlameAgentRuntime` process inside the task container and writes its artifacts to `/logs/agent`.

## Build the local runner bundle

```bash
pnpm install
pnpm benchmark:agent:bundle
export BLAME_BENCHMARK_BUNDLE="$PWD/dist/blame-benchmark-runner.tgz"
export PYTHONPATH="$PWD${PYTHONPATH:+:$PYTHONPATH}"
```

The bundle contains the private benchmark runner and its production runtime dependencies. It is not referenced by `@blame/desktop` and is not included in desktop packages.

Build the bundle on Linux with the same CPU architecture as the Harbor workers. The lightweight bundle currently targets glibc-based x64 and arm64 task images.

## Configure Blame

```bash
export BLAME_API_URL="https://api.blame.so/api/v1"
export BLAME_API_TOKEN="..."
export BLAME_PROVIDER_ID="..."
export BLAME_MODEL_ID="..."
export BLAME_REASONING_EFFORT="high"
```

The configured Blame account must already contain the provider credential selected by `BLAME_PROVIDER_ID`. `BLAME_CREDENTIAL_LABEL` can select a non-default credential.

## Run with Harbor

Install Harbor in its own Python environment, then run a Terminal Bench dataset with the local adapter:

```bash
export BLAME_ISOLATED_ENVIRONMENT="true"
harbor run \
  -d "<terminal-bench-dataset>" \
  --agent tools.terminal_bench.blame_agent:BlameAgent \
  --model "<provider>/<model>"
```

`BLAME_MODEL_ID` takes precedence over the model passed to Harbor. Keep `--model` aligned with it so Harbor labels the result correctly.

The adapter uploads the prebuilt bundle, installs a pinned Node.js 22 runtime when required, and invokes `blame-headless` from the task working directory. It produces:

- `/logs/agent/events.jsonl`: redacted Blame agent events.
- `/logs/agent/result.json`: terminal status, duration, token usage, cost, and event counts.
- `/logs/agent/instruction.md`: the exact rendered benchmark instruction.

Harbor receives input, output, cache-token, cost, status, session, and tool-event metadata from `result.json`.

## Run one workspace directly

```bash
BLAME_HEADLESS_DEV=true \
NODE_ENV=development \
pnpm --filter @blame/benchmark-runner build

BLAME_HEADLESS_DEV=true \
NODE_ENV=development \
pnpm benchmark:agent -- run \
  --workspace /absolute/path/to/workspace \
  --instruction-file /absolute/path/to/instruction.md \
  --task-id local-smoke \
  --events /tmp/blame-events.jsonl \
  --result /tmp/blame-result.json
```

The direct run also requires `BLAME_API_URL`, `BLAME_API_TOKEN`, `BLAME_PROVIDER_ID`, and `BLAME_MODEL_ID`.

Pass `--harness cline` to run the same instruction through the default Cline system prompt and native workspace tools. This comparison mode keeps Blame's credential transport, redacted event recording, model configuration, timeout, and usage reporting, but does not add the Blame briefing, semantic tools, specialist, plugins, or completion contract. The default is `--harness blame`.

For Harbor, set `BLAME_BENCHMARK_HARNESS=cline` in the agent's `env` configuration. The adapter forwards the selection to the same bundled runner; unset or empty keeps Blame. Only `blame` and `cline` are accepted. This baseline measures the bundled Cline SDK, not a separate installation of the Cline extension or CLI. It also retains the runner's common lifecycle and compaction settings. The Harbor adapter is still named `blame`; verify `harness: "cline"` in each runner result. Freeze the bundle and task revisions across both arms and retain unsuccessful attempts when comparing consumption.

Exit code `0` means the agent reached a successful terminal event. Exit code `1` means a runtime or agent failure, `2` means invalid configuration, `124` means timeout, and `130` means cancellation.

On interruption, the Harbor adapter falls back to usage events when the final result is absent or incomplete. Unknown counters remain unknown, and interrupted runs are marked as partial even when the runner returns `failed` instead of `timed_out`. The in-flight generation may not be included in the reported cost.

With Harbor installed in the active Python environment, verify the adapter with `python -m unittest tools.terminal_bench.test_blame_agent` from the repository root.

The [September 5 harness correction report](/mnt/dev/web/Blame/docs/harness-corrections-2026-09-05.md) preserves the paired runs, unsuccessful attempts, prompt ablation, and exact bundle provenance.

The [fifteen-task Cline SDK comparison](/mnt/dev/web/Blame/docs/cline-comparison-terminal-bench-2026-09-05.md) compares the archived Blame campaign with fifteen new native Cline SDK runs from the same frozen bundle. It reports official success separately from consumption and preserves both compression timeouts.

Successful, fresh project validations in Blame return at most 900 characters when the redacted output exceeds 1,200 characters. `outputLog` points to the complete redacted output inside the workspace; inspect it with an ordinary `run_task` command such as `tail` or `cat`. This shortening does not apply to unrecognized inspection commands, failures, or source-changing checks. Logs under `.blame/logs` do not invalidate source freshness. If a log cannot be written, the existing 4,000-character diagnostic fallback remains available.

The [three improvements and contemporary five-task comparison](/mnt/dev/web/Blame/docs/harness-three-improvements-2026-09-05.md) records five frozen before trials, then two groups of ten contemporary Blame/Cline SDK trials. It retains the unsuccessful first iteration and measures the final diagnostic correction in a second frozen bundle. Read the runner's `harness` field when multiple arms use the shared Harbor adapter name.

The [iterative harness cycle](/mnt/dev/web/Blame/docs/harness-iterative-cycle-2026-09-05.md) preserves eighteen trials in groups of ten, four, and four. Each group freezes its own source bundle before outcomes; the last description-only variant is rejected and the default bundle restored to the selected V2. When comparing two versions that both report `harness: "blame"`, identify the version from each trial config’s `agent.env.BLAME_BENCHMARK_BUNDLE`, not the shared Harbor agent name. A failed run with no completed provider usage record must not be counted as free. Report incomplete totals and complete-usage pairs separately, while preserving every official failure in the overall score.

The [September 6 efficiency corrections](/mnt/dev/web/Blame/docs/harness-efficiency-corrections-2026-09-06.md) retain fifteen trials in groups of nine and six: a frozen before/candidate/Cline SDK comparison, then a separate candidate/ordered-patch comparison on the same three tasks. One task was new before the first group; these are not fifteen unseen tasks. Preserve official success separately from runner termination and complete versus partial usage. The missing final runner result in the second group is reported as absent, with Harbor phase duration kept separately. Two iteration-limit runs in the first group have complete usage only after all issued requests and individual counters reconcile. The default bundle additionally contains a tested diagnostic correction that was not live-benchmarked; the manifest records its distinct hash. No benchmark bundle used by an earlier trial is overwritten.

The [expanded September 6 patch measurement](/mnt/dev/web/Blame/docs/harness-patch-sample-2026-09-06.md) tests that final bundle against the version before the patch correction on ten tasks, eight previously unseen, in two groups of ten trials. Count rejected completed calls containing only patch operations separately from symbol, hybrid, malformed and unfinished calls. A task without patch calls has no patch rejection rate; retain it in overall success and consumption. Reconcile event-derived counts against runtime editing metrics and compare complete-usage pairs without discarding failures. The aggregate patch rejection rate falls from 20/42 to 13/41, but stays at 36.36% when Cython is excluded. The report preserves a compiler-confirmed false C syntax rejection, reproduced outside the measured workspace without altering the frozen harness or sending feedback to the measured agent.

The [subsequent corrections and research pass](/mnt/dev/web/Blame/docs/harness-ideation-corrections-2026-09-06.md) corrects C/C++ validation authority, explicit symbol and alias ranges, transport termination and exact command echoes in provider context. C/C++ edits report unsupported syntax validation; project compilation remains the relevant check. Terminal transport failures in non-interactive SDK sessions end promptly rather than attempting to resume a destroyed session. An early failure is not a successful trial or proof of efficiency: retain the cause and incomplete usage. Byte-level replay measurements are reported separately from live model tokens and cost. The paired campaign freezes ten trials on five tasks, including one previously unseen task, without a contemporary Cline arm.

All ten trials finished with reconciled complete usage. The result is unfavorable: official success falls from 4/5 to 3/5, input grows by 31.2%, reported cost by 129.9%, and cumulative runner duration by 19.7%. Both arms reject one patch call; 1/10 versus 1/11 does not mean fewer rejections. Keep the failed 64-iteration Doom candidate in every primary total. Its control stops normally after 37 requests and also fails the official verifier. The new POV-Ray candidate builds the correct version and passes rendering, but omits archive metadata required by the verifier. These trajectories do not establish the causal effect of each correction. The default bundle retains the independently verified mechanical fixes; no global efficiency gain is claimed.

The [contract and context correction pass](/mnt/dev/web/Blame/docs/harness-cache-corrections-2026-09-06.md) records a ten-trial group with equal 4/5 success and lower measured input, cost and duration, followed by four separate symbol-boundary trials with higher cost. The latter exposed binary archive payloads admitted as text by the SDK web executor. Preserve both outcomes and distinguish offline mechanical proofs from live trajectory differences. Python JSONL readers must split on LF (`\n`), not `str.splitlines()`: valid JSON strings can contain U+0085 or U+2028. The updated adapter and collectors retain those records; raw historical data and frozen bundles remain intact.

The final web follow-up preserves another four trials with 2/2 official success in each arm but higher aggregate input and cost. A trace audit finds that its POV-Ray control downloaded public solution, verifier and reference artifacts: retain the nominal score and usage, label the pair contaminated, and do not claim clean superiority from it. The other seventeen traces show no explicit matching oracle retrieval in this bounded audit; that is not proof against training contamination. Final source additionally corrects signal-listing and Git-reference inspection refusals and clarifies the web description. These last changes are tested and replayed after the frozen live campaign, with a separate final bundle and separate synthetic resource measurement; do not relabel older trial bundles.

The selected final bundle is `69cfa03e3dd3358cf27abdf8c1af42a256be26d8043b0f0945b7eaec977d2adb`. Its separate two-run synthetic web measurement exercises the binary fix with one two-URL call per arm and correct answers: 13,892→5,519 input tokens, identical JSON, and a 96,291→190-byte ZIP result. Keep this controlled resource test separate from the eighteen Terminal-Bench trials; it is not a global success or latency estimate. Final validation passes 513 tests and runtime lint.

`BLAME_ISOLATED_ENVIRONMENT=true` is an operator assertion that the runner is already inside an isolated task environment, such as the Docker environment above. It does not create a sandbox. Leave it unset for host workspaces; a Git worktree is not operating-system isolation. The default is false and the value is recorded in each benchmark result. Isolated runs allow authorized environment setup and process control; managed preview restrictions apply only when a preview service is actually attached. The Node dependency operation and remote-script restrictions remain in force.
