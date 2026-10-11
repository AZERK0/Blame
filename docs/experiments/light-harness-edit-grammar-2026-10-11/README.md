# Edit operation grammar experiment

T2 changes only the `edit_code` description. The reference includes retained T1 skill scope and H3 recovery. Previously observed invalid discriminator attempts: 5/50 current Light global trials and 2/8 earlier confirmation trials. All are known diagnostics for T2.

The registered canary is 24 trials; the global panel is 150 trials. A separate 18-trial confirmation selects three newly authored cases after the first four completed canary trials, before its own outcomes and global execution. It does not select or modify the fixed intervention. Model gpt-5.6-luna/high, SDK 0.0.82, separate USD 0.30/1.80/0.30 observed estimate guards and USD 0.05 per-trial guard. Source, prompts, schemas and evaluator bindings are frozen by the existing driver. Models are running; comparative outcomes and the decision are pending.

Risks: added prompt overhead, overuse of whole-body edits, changes in patch choice and stochastic semantic errors. Existing schema and observed-source guards remain unchanged. Local guard replays and complete source/tool review are required before publishing a decision.

Canary completed: all 24 trials and 96 compressed artifacts reviewed/hash-verified. Keep campaigns separate.

| Arm | Audited completed | Observed total tokens | SDK estimate USD | Runner seconds | Token/cost reconciled |
| --- | ---: | ---: | ---: | ---: | ---: |
| reference (retained T1) | 7/8 | 159,367 | 0.02523524 | 204.404 | 8/8 |
| modified (+T2) | 7/8 | 136,505 | 0.02335464 | 187.957 | 8/8 |
| integrated Cline | 5/8 | 110,841 | 0.02753960 | 1,458.448 | 5/8 |

All-arm totals include failures; native resources are observed lower bounds. Each Light arm incorrectly denies archived-editor view in a different repetition despite build/finish success. All native functional checks pass, but two backend trials and one permission trial go quiet after correct patches, before announced builds/final usage. No HTTP evidence identifies the cause. Recorded tool lifecycle is complete; intentions do not establish executed validation.

Primary matched completed-success modified/reference total-token ratio is 0.966 [0.943,0.985] (six pairs, three task clusters); **estimated cost 1.052 [0.899,1.192] and duration 1.068 [0.814,1.236] have adverse point estimates**. Whole-panel token reduction cannot replace this quality-qualified comparison. Modified/native tokens are 1.001 [0.899,1.195], cost 0.770 [0.708,0.794] and duration 1.020 [0.597,1.357] (five pairs). Neither global superiority nor population quality equivalence follows from this selected panel. Invalid discriminator attempts are 1/8 versus 0/8; edit calls 11 versus 8; model requests 40 versus 35. Zero native `edit_code` calls do not mean zero native friction. Cache/request accounting remains incomplete in every trial. Estimate USD 0.07612948 is below its separate USD 0.30 guard; no recovery activates.

Current decision: deepen through the already registered global and fresh confirmation panels. The guard replays show unchanged protections; one semantic miss per Light arm does not identify a runtime regression. Publish unfavorable outcomes and abandon T2 if broader comparable-quality evidence does not support retention. No source repair or task-agent feedback.

Reproduction: freeze clean built runtime/runner snapshots with `tools/terminal_bench/corpus/light-study.mjs`, setting `BLAME_STUDY_DIRECTORY` and a fresh `BLAME_STUDY_WORK_DIRECTORY`; refuse overwrites. For the new confirmation fixture use `tools/terminal_bench/corpus-edit-confirmation/light-study.mjs` and its `prepare`/`audit` modes. Confirm `execution-bindings.json` before models. After every input/source review is recorded, `bash docs/experiments/light-harness-edit-grammar-2026-10-11/finalize.sh <canary|global|confirmation>` reproduces extraction, replays, adjudication, publication, comparisons and integrity checks. It never supplies solutions to task agents. Legacy exploratory filenames retain their names while their T2 registration records the previously discovered diagnostic.
