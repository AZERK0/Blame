# Edit operation grammar experiment

T2 changes only the `edit_code` description. The reference includes retained T1 skill scope and H3 recovery. Previously observed invalid discriminator attempts: 5/50 current Light global trials and 2/8 earlier confirmation trials. All are known diagnostics for T2.

The registered canary is 24 trials; the global panel is 150 trials. A separate 18-trial confirmation selects three newly authored cases after the first four completed canary trials, before its own outcomes and global execution. It does not select or modify the fixed intervention. Model gpt-5.6-luna/high, SDK 0.0.82, separate USD 0.30/1.80/0.30 observed estimate guards and USD 0.05 per-trial guard. Source, prompts, schemas and evaluator bindings are frozen by the existing driver. The canary and global panels are complete; the fresh confirmation is running. The final decision is pending.

Risks: added prompt overhead, overuse of whole-body edits, changes in patch choice and stochastic semantic errors. Existing schema and observed-source guards remain unchanged. Local guard replays and complete source/tool review are required before publishing a decision.

Canary completed: all 24 trials and 96 compressed artifacts reviewed/hash-verified. Keep campaigns separate.

| Arm | Audited completed | Observed total tokens | SDK estimate USD | Runner seconds | Token/cost reconciled |
| --- | ---: | ---: | ---: | ---: | ---: |
| reference (retained T1) | 7/8 | 159,367 | 0.02523524 | 204.404 | 8/8 |
| modified (+T2) | 7/8 | 136,505 | 0.02335464 | 187.957 | 8/8 |
| integrated Cline | 5/8 | 110,841 | 0.02753960 | 1,458.448 | 5/8 |

All-arm totals include failures; native resources are observed lower bounds. Each Light arm incorrectly denies archived-editor view in a different repetition despite build/finish success. All native functional checks pass, but two backend trials and one permission trial go quiet after correct patches, before announced builds/final usage. No HTTP evidence identifies the cause. Recorded tool lifecycle is complete; intentions do not establish executed validation.

Primary matched completed-success modified/reference total-token ratio is 0.966 [0.943,0.985] (six pairs, three task clusters); **estimated cost 1.052 [0.899,1.192] and duration 1.068 [0.814,1.236] have adverse point estimates**. Whole-panel token reduction cannot replace this quality-qualified comparison. Modified/native tokens are 1.001 [0.899,1.195], cost 0.770 [0.708,0.794] and duration 1.020 [0.597,1.357] (five pairs). Neither global superiority nor population quality equivalence follows from this selected panel. Invalid discriminator attempts are 1/8 versus 0/8; edit calls 11 versus 8; model requests 40 versus 35. Zero native `edit_code` calls do not mean zero native friction. Cache/request accounting remains incomplete in every trial. Estimate USD 0.07612948 is below its separate USD 0.30 guard; no recovery activates.

Global completed: all 150 trials manually reviewed and 600 compressed artifacts hash-verified. Reference/modified/native official successes are 46/46/47; functional successes 47/48/49; audited criteria 45/47/44; audited completed deliveries **44/45/44**. Runtime outcomes are 49/48/48 successes, 1/2/0 failures and 0/0/2 timeouts. Keep these distinctions.

| Arm | Audited completed | Observed total tokens | SDK estimate USD | Runner seconds | Token/cost reconciled |
| --- | ---: | ---: | ---: | ---: | ---: |
| reference | 44/50 | 1,229,510 | 0.20358856 | 1,490.495 | 49/50 |
| modified | 45/50 | 1,221,429 | 0.19504488 | 1,337.423 | 50/50 |
| integrated Cline | 44/50 | 994,197 | 0.22701320 | 2,203.772 | 48/50 |

Primary matched completed-success modified/reference tokens are **1.039 [0.914,1.168]**, estimated cost 0.989 [0.833,1.131] (40 reconciled pairs), duration 0.880 [0.593,1.200] (41 completed pairs). Modified/native tokens are **1.127 [0.955,1.349]**, estimated cost 0.824 [0.773,0.889], duration 0.836 [0.728,0.964] (40 pairs). No global efficiency gain over reference is established. The 2 percentage-point quality difference has a descriptive task-cluster interval [-4,+8] points; population noninferiority remains unproved.

Mechanism: invalid-kind affected trials **5/50 versus 0/50**, but edit calls **72 versus 75** and other input blocks **1 versus 7**. Symbolic operations 57/68, patch operations 23/23, model requests 276/272, skill calls 4/4. Fewer grammar errors do not imply fewer total editing corrections. Both native timeouts have correct sources but no executed final build/usage/done, with 329/345-second recorded event gaps; there is no HTTP attribution. One reference trial activates unchanged H3 recovery before any source effect and finishes; its missing request usage excludes tokens/cost from matched accounting, while duration remains.

Fixed timestamp/optional-field conventions give completed reference/modified/native 44/45/44, 45/46/45, 46/46/46 and 47/47/47. Registered extended-mark checks give 42/43/43 in the strict variant. The **new post-hoc valid-percent replay** fails only modified repetition two and changes primary completed counts to **44/44/44**; combined with extended marks they are **42/42/43**. All eight overlays and resource comparisons remain separate in `exploratory-storage-percent-sensitivity.json`, without altering primary scores or selecting a favorable convention. The publication analysis initially asserted an instruction hash against a field absent from result rows; it was corrected to use the existing compressed-artifact inventory, then rerun. This does not change any task, model, grader or outcome.

Current decision: complete the already registered fresh confirmation before retention. Grammar comprehension improves in these diagnostic traces, but broader quality/efficiency benefit is not established. No source repair or task-agent feedback. Observed global estimate USD 0.62564664 is below its USD 1.80 guard, max trial USD 0.01706088; cache/request completeness remains 0/150.

Reproduction: freeze clean built runtime/runner snapshots with `tools/terminal_bench/corpus/light-study.mjs`, setting `BLAME_STUDY_DIRECTORY` and a fresh `BLAME_STUDY_WORK_DIRECTORY`; refuse overwrites. For the new confirmation fixture use `tools/terminal_bench/corpus-edit-confirmation/light-study.mjs` and its `prepare`/`audit` modes. Confirm `execution-bindings.json` before models. After every input/source review is recorded, `bash docs/experiments/light-harness-edit-grammar-2026-10-11/finalize.sh <canary|global|confirmation>` reproduces extraction, replays, adjudication, publication, comparisons and integrity checks. It never supplies solutions to task agents. Legacy exploratory filenames retain their names while their T2 registration records the previously discovered diagnostic.
