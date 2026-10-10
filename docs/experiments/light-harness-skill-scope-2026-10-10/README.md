# Skill scope before long instruction loading

One production change: Light's immutable startup prompt exposes bounded enabled-skill scope metadata. Full skill bodies and availability, schemas, validation and recovery are unchanged. Native Cline gets no suffix. Runtime commit: `2e4e9dce`; reference artifact: `23b454d5` (H1 + H3).

The intervention combines descriptions and a relevance reminder, without isolating their individual contributions. Integrated Cline uses default SDK tools/empty extensions and does not enable Blame's built-in skills service; zero native skill calls do not demonstrate relevance selection. Whole-harness comparison retains that existing configuration difference.

The previous ordinary campaign's 40 completed both-success pairs expose 1,532,861 repeated Light skill-result bytes, 48% of message bytes. SDK discovery advertises names but omits available scope descriptions. See `prior-diagnosis.json`. Bytes describe exposure, not billing.

Three separately registered campaigns use gpt-5.6-luna/high and integrated SDK 0.0.82:

| Campaign | Selection | Trials | Observed SDK estimate stop |
| --- | --- | ---: | ---: |
| canary | Four known diagnostic tasks, one repetition | 12 | USD 0.30 |
| global | All 25 known corpus tasks, two repetitions | 150 | USD 1.80 |
| confirmation | Four newly authored cases, two repetitions | 24 | USD 0.30 |

Per-trial SDK estimate limit is USD 0.05; these limits are not invoice caps. Confirmation cases were selected after partial canary inspection but before their own outcomes and before global execution. They do not select the runtime intervention. Their fixture/evaluator are separate; exact card CSS criteria do not certify aesthetic quality. Grader self-check examples never enter agent workspaces.

Canary: all arms achieve 4/4 audited completed successes. Modified tokens are 72,931 versus 101,476 reference and 71,388 Cline: a 28% reference gain, **2% more than Cline**. Modified preserves the applicable accessibility skill invocation. Global and confirmation results are pending. Do not infer superiority from a favorable subset.

Reproduction uses the existing installed toolchain and inherited provider environment, with no credential logging:

```sh
node node_modules/typescript/bin/tsc -p packages/agent-runtime
node packages/agent-runtime/scripts/copy-prompt.mjs
node node_modules/typescript/bin/tsc -p packages/benchmark-runner
```

Set `BLAME_STUDY_DIRECTORY` to the registered campaign directory and `BLAME_STUDY_WORK_DIRECTORY` to a new artifact directory. Freeze clean built versions using `tools/terminal_bench/corpus/light-study.mjs freeze baseline` and `freeze modified`, then `run`. Published provenance hashes fixtures, evaluator, driver, lockfile, compiled runtime and schema; copied snapshots must retarget their runtime symlinks.

For confirmation use `tools/terminal_bench/corpus-confirmation/light-study.mjs`; its `prepare` materializes the shared driver/scorer/auditor with only corpus import substitutions. `execution-bindings.json` records those inputs. `check-evaluator.mjs` validates graders before model execution.

Extract candidates and raw tool lifecycle, inspect every instruction/input/source diff, and record reviewed decisions before `light-study-reviewed-adjudication.mjs` and publication. Preserve original scores, source/function criteria, executed builds, admitted verification and runtime termination separately. Known pagination/reducer conventions are reported uniformly. `light-study-registered-analysis.mjs` binds the unchanged comparison computations to registered endpoints; `light-study-skill-mechanism.mjs` reports full-panel skill calls/context exposure. Cache/request missingness, timeouts and failures are retained; SDK estimates are not reconciled invoices or served-weight revision certificates.

`light-study-quality-uncertainty.mjs` adds exploratory descriptive completion differences, not statistical equivalence. An extended-diacritic counterexample was discovered during first-repetition inspection; `light-study-slug-replay.mjs` and `light-study-criterion-sensitivity.mjs --exploratory-slug` preserve it separately from the registered endpoints and apply it to all arms/repetitions.
