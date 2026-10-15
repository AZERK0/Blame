# F29 lexical phrase priority — completed

All **18/18** preregistered model trials completed and passed the unchanged frozen endpoint. These are two fresh related tasks on one familiar Lodash monolith, three dependent repetitions and three rotated arms, not 18 independent issue clusters.

| Arm | Frozen endpoint | Audited behavior | Full audited | Observed tokens | SDK USD |
|---|---:|---:|---:|---:|---:|
| All-six baseline | 6/6 | 6/6 | 4/6 | 1,023,482 | 0.08329264 |
| Ranking candidate | 6/6 | 4/6 | 4/6 | 651,343 | 0.05920860 |
| Repaired integrated Cline | 6/6 | 5/6 | 3/6 | 1,165,430 | 0.09875688 |

**Decision: do not promote the ranking prototype to production.** Lower observed tokens do not demonstrate efficiency at comparable task quality. Full audited counts also include factual reporting criteria; equal full counts can conceal different behavioral quality. See [decision.md](decision.md), [findings.md](findings.md) and [report.md](report.md).

Retrieval improves locally: the same initial `function forIn` query returns the declaration at line 13015 in all three candidate runs, versus the wrapper at line 9 in all three baseline runs. Across differing natural queries, contiguous top snippets occur in 25/31 candidate multi-term calls versus 0/36 baseline calls. This is descriptive mechanism exposure, not a randomized mediator or a population success effect.

A post-selected source audit found a frozen-checker blind spot. Customized `lodash.iteratee` hooks distinguish original default iteration from own iteration on falsy primitives. Two candidate endpoints and one Cline endpoint violate the explicit preservation requirements despite passing their supplied tests. The supplementary diagnostic evaluates 56 cases on each of the nine iterator endpoints; these are correlated probes, not 504 tasks. Original official/frozen scores stay unchanged. No source repair, reference solution recovery, model retry or diagnostic feedback occurred. Earlier default-only and expanded diagnostic records remain preserved.

Factual failures remain separate: two baseline reports relabel unreported Node pending as zero; one native report gives a nonexistent absolute file path; another contradicts its modification with a blanket no-files-changed claim. Ambiguous no-additional-declarations wording is not independently penalized when the requested parameter changes are explicit. `source-review.json` records the unblinded, SHA-bound judgments and their limits.

Primary resources require matched full audited completion, reconciled input/output/cost and no observed wire/report gap. Only three candidate/baseline pairs qualify: -33.6% tokens, -21.6% estimated cost and -5.9% worker time. This selected successful subset does not repair the candidate's lower all-attempt behavioral success. The original frozen-functional sensitivity can include the demonstrated semantic failures and is explicitly not a comparable-user-quality estimate.

New observed SDK estimate: **USD 0.24125812**, no new missing-response reserve. Cumulative accounting is **USD 3.74173048**, reference **EUR 3.34827**, including retained **USD 0.92 reserves**, within the cumulative EUR 10 ceiling. Estimates are not invoices; full cache, hidden retries and host/tool costs remain unknown. The nominal output cap remains ineffective on actual OAuth.

The reference is bundle `5f310425`, distinct from F28 reference `50680158`. Only two executable ranking modules differ in the measured candidate; schemas, prompt sources, edit/validation code and production file sets match. Registration `6b53b2eb` preceded dispatch. All input/environment/runtime hashes, actual prompt/schema contracts, native repair and the parent financial witness are retained. Later local production diagnostics are labeled separately.

```sh
python tools/terminal_bench/phrase-study/verify-public.py docs/experiments/light-harness-phrase-ranking-f29-2026-10-15
python tools/terminal_bench/phrase-study/publication-controls.py docs/experiments/light-harness-phrase-ranking-f29-2026-10-15
```

The Python replay checks original bytes, decisions, counterexample arithmetic, paired resources and financial carry-forward without models or private workspaces. It does not independently re-adjudicate manual source judgments or execute the JavaScript counterexamples. `iteratee-default-diagnostic.mjs` supplies their separate zero-model reproduction.
