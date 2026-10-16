# F41: isolated compiler-invocation admission

This fourth cycle follows the completed [F38b](../light-harness-iterative-f38-2026-10-16/README.md) audit: all eight Light tasks ran the required TypeScript script with exit0, yet the name `test:study:types` made it a test with unknown counters and left `check:types` missing. Evidence is in the original tool ledgers and completions. This problem persisted in current code before the fix.

The registered hypothesis is that recognizing literal compiler-only scripts can admit the required invocation without inventing test counters or code coverage. A narrow implementation (`b3aa4571`) classifies only supported literal `tsc --noEmit` forms, preserves the actual npm wrapper/lifecycle status, and propagates **invocation-only** scope with `paths=[]` into the journal/check report. A successful compiler invocation can satisfy its own obligation; it cannot establish verification for files outside its project. Compound/expanded/lookalike commands retain conservative behavior. Existing legacy project-scope heuristics for other tasks are not repaired by this change.

Local controls initially pass 5/8. A naïve classification-only repair passes eight but fails a new counterexample: an excluded edited source is incorrectly marked verified. That candidate is rejected. The scoped repair passes nine new controls and all 55 relevant cases, covering compiler errors, failing npm hooks, stale sources, test counters, aliases and excluded files. Original adverse logs are retained in the parent phase. This is a semantic admission improvement, not evidence that additional tests executed.

The model protocol was committed in `888cb304` before launch: the **known** Axios clear-count task, three dependent repeats, rotated order, reference Light / compiler Light / integrated Cline. Reference is F38b's declaration-enabled runtime. Only four compiled executable modules change; F39 patch diagnostics and F40 runner observability are excluded. Model, actual cap, task instructions, selected oracles, SDK, environment/dependencies and per-trial budgets match F38b. One task repeated is not new-project confirmation; campaigns are not pooled.

| F41 arm | Official / independent / audited (of 3) | Input + output tokens | SDK estimate USD | Worker seconds | Required compiler admitted |
|---|---:|---:|---:|---:|---:|
| Reference Light | 3 / 3 / 3 | 440959 | 0.03664588 | 145.353 | 0/3 |
| Compiler Light | 3 / 3 / 3 | 349964 | 0.02762120 | 106.480 | 3/3 |
| Integrated Cline | 3 / 3 / 3 | 489383 | 0.04291468 | 128.526 | N/A |

Source verification remains **unverified** for all six Light trials, as intended. All required checks actually executed after the last edit. Native source-verification admission has no corresponding structured contract; it is N/A. One Cline agent-added Mocha test cannot run because `cross-env` is absent; its failure127 and the agent's explicit disclosure are preserved. The required selected checks and independent supplied oracles pass. A reference summary understates an available exit result; it is retained as reporting friction, not relabeled as a passing-suite fabrication.

Quality and registered aggregate resource gates pass. Compiler/reference totals change by −20.6% tokens, −24.6% estimated cost, −26.7% duration; compiler/Cline changes are −28.5%, −35.6%, −17.2%. **Token improvement is not robust across repeats:** paired token changes versus reference are +15.5%, −50.3%, +22.7%. Reference repeat2 has multiple edit failures and check reruns. Omitting that pair reverses the aggregate to +19.0%. These original outcomes remain in the primary cohort; the omission is a labeled post-hoc sensitivity, not a new gate. Cache differences, stochastic trajectories, dependent repeats, unblinded review and nonexclusive host limit causal attribution. Keep the correctness fix; deepen efficiency confirmation rather than declare a general gain.

`protocol.json`, `execution-bindings.json`, `launch-provenance.json`, `isolation-controls.json`, the four-module `candidate-overlay.json.gz`, raw traces, source review, invocation witnesses, `mechanism.json`, summaries and explicit accounting support the result. All 27 independent endpoint invocations reproduced from original public patches, with no model calls, source repairs or recovered reference solution. Aggregate token/cost receipts reconcile; per-request cache details remain incomplete. Additional observed SDK estimate: USD 0.10718176; new reserve: zero. Prior reserves remain unchanged.

```sh
node tools/terminal_bench/iterative-study/verify-public.mjs docs/experiments/light-harness-compiler-check-model-f41-2026-10-16
node tools/terminal_bench/iterative-study/replay-public.mjs --study=/workspace/Blame/docs/experiments/light-harness-compiler-check-model-f41-2026-10-16 --install-deps=true --output=/tmp/f41-endpoints.json
node tools/terminal_bench/iterative-study/compiler-mechanism.mjs
```

Use your absolute checkout path for `--study` when reproducing elsewhere. Public verification checks recorded evidence and arithmetic, not independent human acceptance or invoices. Reproduction requires the pinned fixture packages; full upstream development/browser dependencies are deliberately outside the selected suite.

Recorded source/registration commit IDs predate a concurrent identical-tree history rewrite; see the parent phase’s `history-equivalence.json` for current equivalents. Protocol bytes are preserved.
