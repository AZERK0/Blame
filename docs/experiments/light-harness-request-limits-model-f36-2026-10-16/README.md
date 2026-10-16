# F36: effective output-cap diagnostic

Status: all twelve preregistered assignments completed and reviewed. No trial was replaced or repaired. Retain the explicit output-limit contract; neither within-harness efficiency gate passes. These dependent repeats on one known task do not establish population superiority or an optimal default cap.

## Results and decision

| Arm | Official success | Frozen endpoint | Strict full audit |
| --- | ---: | ---: | ---: |
| Reference Light | 3/3 | 3/3 | 2/3 |
| Capped Light | 3/3 | 3/3 | 2/3 |
| Integrated Cline, uncapped | 1/3 | 2/3 | 1/3 |
| Integrated Cline, capped | 3/3 | 3/3 | 2/3 |

Both registered quality gates pass; both resource gates fail. Each strict paired-success comparison contains only repetition one:

| Comparison | Tokens | SDK-estimated cost | Worker time |
| --- | ---: | ---: | ---: |
| Capped/reference Light | +45.1% | +1.0% | +22.0% |
| Capped/uncapped Cline | −24.2% | +4.6% | +10.5% |
| Capped Light/capped Cline | −20.9% | −33.1% | −7.8% |

The last row has one joint success and equal observed strict counts, not evidence of general harness superiority. Across all three Light assignments, capped totals are worse: +64.4% reported tokens, +34.1% estimated cost and +24.4% time. Capped native worker time is 77.1% lower across all assignments, with more official completions, but uncapped native has two missing request usages: total token/cost efficiency cannot be established from its observed totals. The distinct paired and all-assignment results must not be substituted for each other.

All 72 treatment forwarding attempts carry 8,192; all 51 reference attempts omit it. There are 121 usage reports for 123 forwarding attempts. Every reported treatment output is below the cap (maximum 2,044 in native and 1,632 in Light); no truncation at 8,192 is observed. This does not exclude a planning effect of the parameter, but the small panel does not identify why the uncapped native responses stalled. Six initial normalized contracts agree within each harness. Actual raw workspace paths differ.

Uncapped native R2/R3 time out at 600.875s/601.086s. The former has a passing final endpoint without agent validation/delivery; the latter makes no effective tool call and leaves the feature absent. Light reference R3 temporarily edits a forbidden file then reverts it. Light candidate R2 reports a different literal npm spelling from its actual invocation. Capped native R3 has clean visible validation but unrecorded earlier individual exits; the separate apparent-validation sensitivity changes only its full acceptance to true (native capped 3/3). No grades or original runs are recovered. See [findings.md](findings.md) and the bound source reviews.

F36 adds SDK-estimated USD 0.25372472 and retains USD 0.46 for its two unreported requests: accounted USD 0.71372472. Cumulative observed estimates become USD 4.68580432 plus USD 1.94 reserves, accounted USD 6.62580432. Original zero accumulators, request/report gaps, unknown per-request cache/reasoning and unpriced work remain visible. Reserves are not measured spending.

Keep the opt-in transport correction for budget correctness. Do not promote 8,192 as a performance default. Next, evaluate precise dependency declarations and scoped-patch diagnostics independently, then confirm on new, unhinted tasks on a larger project. The declaration route remains proposed, not implemented; [next-experiment.md](next-experiment.md) prepares its local gate and selection protocol.

## Registered comparison

Commit `5cf2656b` registers one known YAML task, three dependent repeats, four rotated arms:

| Arm | Harness | Actual request limit |
| --- | --- | --- |
| baseline | Light | omitted |
| candidate | Light | 8,192 |
| cline | integrated Cline SDK | omitted |
| cline-cap | integrated Cline SDK | 8,192 |

Both frozen runtimes share the current factory wiring; only the old/new provider-compatible HTTP helper differs. The reference is not a literal complete historical-release checkout. Both native arms include the previously pinned research search repair. Model `gpt-5.6-luna`, effort `high`, SDK 0.0.82, task source/checkers, prompts, schemas, environment and budgets are bound in the protocol and execution receipts. The inherited `requestMaxOutputTokensEffective:false` describes the original configuration assumption; the explicit per-arm mapping and post-trial wire checks establish the treatment. The date label is not a measured commit timestamp. Inherited preparation notes are historical context, not new task preparation or fresh confirmation.

Compare capped versus reference within each harness before comparing the harnesses with equal actual limits. Quality comes first: no fewer fully audited completions or source-behavior passes. The registered resource signal requires at least 10% fewer paired-success tokens or estimated cost, cost increase at most 5%, worker-time increase at most 10%. All outcomes remain in quality/accounting; paired resources condition on joint audited success and do not describe failed attempts or population efficiency.

The task deliberately requires four literal commands in order after the last edit. `npm run test` and `npm test` both retain lifecycle hooks, but only the latter is the frozen requested spelling. A report naming a command that was not actually executed is a separate factual defect. Unknown type-test counts remain unknown. A semicolon chain with explicit captured individual statuses can establish each exit; a last-command status alone cannot establish earlier non-test exits. Optional apparent-validation sensitivity is published separately, never substituted for the primary audit.

The output contract is checked after every trial, independently of coding outcomes. Missing usage/capture is retained; no usage is fabricated from a request attempt. Capped outputs at the limit, incomplete arguments and SDK truncation failures must remain visible. Limits can harm useful reasoning or patches; the prior single backend stress probe establishes enforcement, not the best limit or an efficacy improvement.

Costs are SDK estimates. The cumulative starting ledger is USD 4.4320796 observed plus USD 1.48 retained reserves, accounted USD 5.9120796. The phase voluntarily retains USD 4.5 and the shared USD 10.951612 technical stops; prior consumption is not reset. Cache is a subset of input and reasoning a subset of output. Missing per-request cache/reasoning, hidden retries and unpriced researcher/host/setup work remain explicit.

`missingConsumption` counts absent aggregate fields. `incompleteTokenCostAccounting` and `unreportedForwardingAttempts` also retain request/report gaps. In particular, an SDK zero accumulator with no usage receipt does not establish zero spending. The original SDK `context.modelRequests` counter is the number of input-usage reports (`BenchmarkMetricsCollector`), not a transport-attempt count; use the captured request/report ledger for that distinction.

Public no-model checks, from the repository root:

```sh
node tools/terminal_bench/request-limit-model-study/verify-public.mjs
node tools/terminal_bench/request-limit-model-study/publication-controls.mjs
node tools/terminal_bench/request-limit-model-study/cap-contract-controls.mjs
node tools/terminal_bench/request-limit-model-study/replay-public-behavior.mjs --full
```

Original model traces, source diffs, scores, actual prompt/schema bytes and cap receipts are compressed in `traces/` and bound by `inventory.json`. `source-review.json` records unblinded researcher-agent decisions. The byte/accounting verifiers check original bytes, settings and arithmetic; they neither independently adjudicate source behavior nor rerun models. All twelve corruption controls pass, including rehashed wire-setting changes. New tasks on an additional larger project remain necessary before generalization.

The separate behavior replay reconstructs original source endpoints from public source/test archives and diffs, checks recorded hashes, builds, and repeats UTC/non-UTC feature probes, supplied tests, types and the original suite. It does not replay the agent's actions or repair missing agent verification/delivery. It reuses pinned dependencies, with an explicit optional `--install-deps` for a fresh environment. The original model driver deliberately refuses to overwrite assigned trials; a new model campaign needs a new registration.

Executed locally with `--full`: all twelve reconstructed endpoints match the original source hashes and recorded probe/type/suite outcomes, including the unchanged-source native failure. This is successful reproduction of twelve outcomes, not twelve successful agent tasks. See `public-behavior-replay.json`.
