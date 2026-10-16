# F36: effective output-cap diagnostic

Status: fixed twelve-assignment campaign in progress. Use `summary.json` for completed and reviewed counts; unreviewed outcomes are not audited successes. No outcome-based extra trials or task repair is permitted.

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

Public no-model checks, from the repository root:

```sh
node tools/terminal_bench/request-limit-model-study/verify-public.mjs
node tools/terminal_bench/request-limit-model-study/publication-controls.mjs
node tools/terminal_bench/request-limit-model-study/cap-contract-controls.mjs
```

Original model traces, source diffs, scores, actual prompt/schema bytes and cap receipts are compressed in `traces/` and bound by `inventory.json`. `source-review.json` records unblinded researcher-agent decisions. These replays check original bytes, settings and arithmetic; they neither independently adjudicate source behavior nor rerun models. New tasks on an additional larger project remain necessary before generalization.
