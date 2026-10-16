# F38–F40: iterative diagnosis, implementation and evidence

Four completed cycles are documented here and in [F41](../light-harness-compiler-check-model-f41-2026-10-16/README.md). Model snapshots, local replays and current production changes are separate. Study selection and protocols were committed before their respective outcomes; no agent solution was repaired.

## Cycle 1 — F38b declaration utility on Axios

Axios v1.12.2 (`4150efd104826d7af27d014378bf874964aa26ff`, 62 production JavaScript files) provides two researcher-authored feature tasks: interceptor clear counts and opt-in asynchronous legacy FormData length. Both require implementation plus ESM/CJS declaration changes. Inputs omit implementation locations. This is a larger navigation space, not a representative random sample of upstream issues. Common research compiler configuration enables installed-dependency navigation; it is not upstream default behavior.

Two dependent repetitions per task compare pre-F37 Light, declaration-enabled Light, and integrated Cline SDK. All use `openai-codex/gpt-5.6-luna/high`, SDK 0.0.82, actual output cap 8192, 32 iterations, 600s plus 25s watchdog, request size 290000 bytes, SDK soft limit USD 0.10 and USD 0.23 scheduling reserve. Protocols, prompt/schema bytes, wire observations, dependency lock, executable hashes and actual command results are retained. Native search repair is common with earlier studies; this is not the unmodified Cline CLI. Provider seeds/revision and invoices are unavailable; host timing is nonexclusive.

| F38b arm | Official / independent / audited | Input + output tokens | SDK estimate USD | Worker seconds |
|---|---:|---:|---:|---:|
| Reference Light | 4 / 4 / 4 | 558003 | 0.04551392 | 231.656 |
| Declaration Light | 4 / 4 / 4 | 701178 | 0.05853684 | 250.641 |
| Integrated Cline | 4 / 4 / 4 | 814676 | 0.06950948 | 419.105 |

All three counts have denominator four. No declaration-view call occurred in any of the twelve trials. Candidate/reference tokens increase 25.7%, estimated cost 28.6% and duration 8.2%; quality gate passes, resource gate fails. This does not establish lookup mediation, general uselessness of declarations or a success-rate improvement. Retain the bounded read-only capability on local correctness evidence; abandon the claim of demonstrated global benefit on this panel. Do not add more bundled guidance from this result.

The initial F38 campaign is **infrastructure-invalid and separate**: three Light initializations lacked prompt assets, one native task ran, eight assignments never started. Four raw trials, the missing fourth scheduler exit, original binding, administrative stop and accounting are retained under `initial-*` and `local/initial-*`. Its USD 0.01284832 is observed; USD 0.99 remains a conservative reserve, not spending. The corrected F38b campaign restores identical common assets, freezes again and runs all twelve preselected slots. Because a native clear task had already been observed, this is not wholly fresh confirmation. Earlier oracle-setup failures are also preserved.

## Cycles 2 and 3 — local changes, no model gain claimed

| Diagnosis and original evidence | Implemented mechanism | Comparison and result | Decision / remaining risk |
|---|---|---|---|
| F36 candidate repeat2: exact patch context extends past the selected `composeNode` symbol; generic advice does not distinguish stale text from scope conflict. Still present before F39. | F39 (`016e625c`): after scoped context mismatch, bounded, nonmutating whole-file planning identifies exact applicability and affected lines. No automatic widening, edit or observation credit. | New controls 6/10 → 10/10; relevant suites 32/32. Seven original refused edits replayed against their observed preimage: all remain blocked, three gain a specific scope diagnosis, four retain existing header diagnoses. Bytes 10015 → 10855; local time 1.748 → 2.545s (noisy). | Keep diagnostic correctness; model retry reduction is untested. Extra diagnostic bytes/work are adverse. Stale, ambiguous, malformed and over-budget patches retain existing guards. |
| F36 native repeat3: one wire attempt, zero usage receipts, historical `modelRequests=0`; repeat2 has four wire attempts but three receipts. Still present before F40. | F40 (`fb93dce9`): event-only metrics return transport requests/response counts as null, label iteration starts and usage/input-token observations separately, and preserve unknown input means/maxima. | New controls 0/8 → 8/8; relevant suites 15/15, full runner 37/37. Four recorded traces preserve other metrics and accounting; old 3/0 counters become null, alongside explicit 4/1 iteration starts and 3/0 receipts. Four legacy consumer controls pass. | Keep truthful observability. Actual transport instrumentation remains absent from this collector; iterations and receipts are not billing. No task-success or token reduction expected. |

F39/F40 were **not** bundled into F38b or F41 model snapshots. Local replay timing uses a logical clock where stated, not reconstructed original wall time. New local diagnostics do not become additional successful coding tasks.

## Reproduction and evidence

From repository root, with Node 24.19.0:

```sh
node tools/terminal_bench/iterative-study/verify-public.mjs
node tools/terminal_bench/iterative-study/replay-public.mjs --install-deps=true --output=/tmp/f38-endpoints.json
```

The first command checks hashes, registered ordering, actual contracts, recorded receipts, arithmetic and supplied replay evidence; it cannot independently adjudicate prose or prove provider billing. The second installs the pinned fixture dependencies without lifecycle scripts, reconstructs all twelve source endpoints from the public pristine archive plus original agent diffs, checks source hashes and reruns the three selected supplied scripts. It calls no model and replays no agent decisions. The recorded rerun matches all 36 invocations. Full upstream browser/package suites were not run.

`traces/*.json.gz` contain original individual file bytes and hashes, including events, diffs, independent grades, final results and prompt/schema evidence. `source-review.json` records unblinded research-agent judgments; `invocation-witnesses.json` supplies final-source execution evidence. Cline single-command `success` is exit-status based in the frozen SDK; absent raw numeric exit codes remain absent. Aggregate input/output/cost receipts reconcile for every corrected trial, but per-request cache fields are incomplete; reported aggregate cache values and unknown reasoning details are retained without double-counting.

`local/` preserves the full validation logs and exact common prompt/plugin assets plus frozen runner missing from the earlier JS-only archive. Combine these with F37's reference JS and optional declaration overlay to reconstruct runtime code; SDK package versions and installed-tree hashes are recorded, not vendored. `preparation/` retains source/dependency inputs and the actual historical root lockfile. Scripts `historical-scope.mjs`, `request-observation-replay.mjs`, and `legacy-report-controls.mjs` reproduce local diagnostics using the documented archived/current builds. They are not model campaigns.

`validation.json` separates intended before-fix failures, a rejected naïve compiler-scope repair, and an existing timing-sensitive cursor test fixed independently. Final registered runtime: 910 passed, 2 skipped, 0 failed; runner: 37/37. After F41, cumulative historical/new observed SDK estimates are USD 4.97939464 plus USD 2.93 reserves. This invocation's F38 initial + F38b + F41 observed addition is USD 0.29359032. No missing historical consumption was silently filled or reserve released.

A concurrent remote history rewrite changed some commit IDs without changing their trees. `history-equivalence.json` maps the recorded IDs to the verified current equivalents; original launch protocols and outcomes remain unchanged.
