F43 — bounded missing-path recovery, completed

The 18 registered assignments completed without retry, timeout, administrative interruption or a recorded wire/usage-count gap. These are three **known** constructed Valibot tasks, two dependent repeats and three arms. They are not fresh confirmation or 18 independent real issues. F42 remains a separate campaign.

| Outcome / six assignments | Light reference | Light recovery | Integrated Cline |
| --- | ---: | ---: | ---: |
| Official completion | 6 | 6 | 6 |
| Selected independent checks | 6 | 6 | 6 |
| Strict audited completion | 6 | 6 | 5 |
| Total input + output tokens, all assignments | 2,359,099 | 2,899,913 | 4,115,964 |
| SDK estimated USD, all assignments | 0.15699036 | 0.16653096 | 0.23888252 |
| Observed seconds, all assignments | 633.384 | 692.165 | 912.807 |

**Decision: retain the bounded diagnostic, reject the claim of demonstrated efficiency improvement, and investigate validation coverage next.** The registered decision explicitly permits local diagnostic retention when the efficiency gate fails. Both Light arms pass six audited tasks; the candidate has **+22.9% tokens, +6.1% SDK cost and +9.3% duration** against reference. Quality and observed-use gates pass; the resource gate fails. This is not evidence that the tiny feedback response caused every costly trajectory.

The candidate uses **42.6% fewer tokens, 38.3% less estimated cost and 34.5% less time than Cline on five paired audited successes**. The omitted pair remains in the all-assignment table, including its costs: Cline's new hideInput test runs successfully but does not compile under the upstream exactOptionalPropertyTypes setting (TS2379). Its implementation and original assertions pass. Comparing all six selected-check successes gives a smaller 29.5% token difference, but includes that invalid delivered test. Neither comparison establishes a general harness advantage or attributes existing Light/Cline differences to this patch.

Mechanism and adverse outcomes

- Three hints in two message-prefix trials are followed by successful explicit reads in later model iterations; two are the direct next navigation by tool-start order. Feedback totals 1,602 serialized bytes, not billed tokens. No automatic read, target choice, alias, edit coverage or write is granted.
- Message-prefix tokens fall 27.4% over two pairs; hide-input rises 56.5%, fallback-when rises 42.5%. Recovery is never offered on the latter two tasks. Three token wins and three losses; leaving one pair out spans -7.5% to +42.2%. Omitting any whole task leaves a token increase. No outlier is removed from the primary result.
- Literal missing reads are 15 for reference and seven for candidate. These are different trajectories, not a controlled count of avoided searches. All six reference-mode searches across Light arms fall back lexically because a symbol target is missing. Declaration reads remain unused; raw reads dominate.
- Uniform independent audits run the original related runtime/type assertions on three pristine controls and all 18 unchanged endpoints, plus delivered added tests. Only the Cline hideInput added-test typecheck fails. The original website metadata schema accepts all 18 endpoints, including both Config documentation additions. These are focused audits, not full-project verification. No solution is repaired or retrieved.
- All 18 native timings have ordered wire/usage events, but they do not isolate provider compute. Cline sends unsupported timeout/timeout_ms arguments in 122 of 132 run_commands calls; the captured schema exposes only commands and pinned SDK uses its factory bashTimeoutMs. Source/schema inspection establishes a feedback mismatch, not an observed timeout failure. This cycle does not change command deadlines.

Implementation and comparability

Production change: `45dc1f13` adds missing-literal-path feedback through the existing index. It checks at most 32 exact-basename candidates and returns at most five valid paths; large ambiguous sets, protected/deleted/gone/non-file/symlink paths are suppressed. Unrelated ENOENT, aliases, declarations and successful reads retain their behavior. Ten new controls and 30 nearby controls pass. Full runtime: 920 pass, two skipped; runner: 37/37. The separate formatter fixture repair `b7fb015b` makes its Markdown mock perform the mutation it claims to test. The failure reproduced on both frozen reference and candidate before repair; production formatting is unchanged.

Registration precedes model execution (`e6598c3e`); only light-workspace.js differs between frozen Light executable trees. Compiler admission, helper bytes, prompts and schemas are shared. Both arms admit six required compiler invocations; neither admits whole-source verification. Integrated SDK0.0.82 includes the common research search repair. Actual model/effort are gpt-5.6-luna/high; output8192, iterations48,900s+25s watchdog,500000 request bytes,USD0.25 soft trial+0.23 reserve. See protocol.json and execution-bindings.json for exact identities.

Node24.19.0, npm11.6.4, dependencies and locks are pinned. Every trial gets copied dependencies and an empty offline cache outside ancestor node_modules. The shell prelude reestablishes the pinned PATH after login-shell initialization. Four common required checks include related original runtime assertions and old explicit-generic compatibility. Those checks, clearer existing-test preservation and improved isolation differ from F42 and can affect quality; cross-campaign improvement is not a recovery treatment effect. Source review is unblinded. No OS filesystem sandbox or exclusive host is claimed. No other model, test or compiler workload was scheduled during these workers.

Accounting

All 274 recorded forwarded attempts have usage reports; input/output/SDK-cost aggregates reconcile. Cache-read totals are included in input: reference2,011,008, recovery2,581,248, Cline3,604,096. Per-request cache reconciliation remains incomplete; aggregate zero cache-write does not prove zero cache writes. Hidden retries, provider revision/seeds and invoices are unknown. F43 adds USD0.56240384 in SDK estimates and no new uncertainty reserve. Prior USD3.64 reserve remains; cumulative completed-aggregate observations are USD7.12655384 and scheduling accounting USD10.76655384. The separate F42 partial receipts remain separately disclosed; researcher-agent, host/setup/tool/audit costs are unpriced. Scheduling ceilings are not measured spending.

Reproduction without model access

From the repository root, with Node24 and npm available:

```sh
node tools/terminal_bench/path-recovery-study/verify.mjs
node tools/terminal_bench/path-recovery-study/restore-inputs.mjs --install
node tools/terminal_bench/path-recovery-study/replay.mjs --output=/tmp/f43-endpoint-replay-new.json
node tools/terminal_bench/path-recovery-study/replay-audit.mjs --install --output=/tmp/f43-focused-audit-new.json
```

Use a new output path; scripts refuse overwrites. The first command checks archived bytes, all assignments, usage, ordered contracts, audited decisions, pair statistics and gates. The endpoint replay applies original published patches to pristine pinned inputs and runs four original selected checks. The audit replay additionally reproduces the uniform related upstream and delivered-test runtime/type audit from public sources; it installs only its separate pinned audit dependencies. `--only=1-valibot-hide-input-cline` retains all three pristine controls and selects the failing delivered test. These commands reproduce checks, not model randomness or invoices.

`source-review.json`, `upstream-tests-witness.json`, `metadata-witness.json`, `results.json`, `summary.json`, `accounting.json`, `friction-observations.json`, `tool-usage.json`, `timing-observations.json` and compressed original traces preserve acceptance and its limits. Six mutation controls reject dropped trials, altered usage/audit/deltas/gates and corrupt traces. The original preparation history and adverse controls remain in preparation-history.md. All 18 selected-check endpoint replays match. A separate public audit replay matches three pristine controls and the failing Cline added-test endpoint, including its type failure; it is explicitly a four-record subset of the 21-record uniform witness. Replays are not extra model successes.

Next: prioritize explicit validation scope for changed tests/extra files; separately evaluate feedback for unresolved semantic-reference targets and unsupported command arguments. Keep each treatment isolated, select tasks before results and preserve unused mechanisms and adverse outcomes.
