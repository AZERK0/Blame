# Exact declaration navigation: local evidence

Base: `6d1d1909`; retained implementation: `ab03efbb`. No paid model requests.
The sole runtime change ranks exact leaf/qualified declaration names before
substring matches within files the bounded search already visits. Eight results,
scope/size limits, lexical references, tool schemas, prompts and edit guards stay
fixed. Returned aliases alone confer no read or edit authority.

## Findings and decisions

The old symbol search fills eight slots in source order. In pinned Lodash
`lodash.js`, `map`, `clone` and `get` are displaced by longer partial names.
`initial-diagnosis.json` reproduces these current-code defects; F21--F23 traces
also show unnecessary outlines despite already available compact symbol reads.
This is missing navigation information, not evidence of model reasoning failure.

Register twelve queries before replay: six known diagnostics and six additional
local mechanism probes, three repetitions, symbol/auto/text modes. The extra six
are internally selected local probes, not fresh model tasks or external holdouts.

| Unique query results, symbol and auto separately | Base | Retained |
| --- | ---: | ---: |
| Exact declaration present, six diagnostics | 3/6 | 6/6 |
| Exact declaration present, six additional probes | 4/6 | 5/6 |
| Exact declaration present, all twelve | 7/12 | 11/12 |
| Exact declaration first, all twelve | 4/12 | 11/12 |

Each repetition agrees on these outcomes. All 36 paired text responses are
unchanged; the text mode's absence of `qualifiedName` is not a text-quality
failure. All 114 available exact-alias body reads succeed without source changes.
Response bytes are retained, but different/missing declarations are not matched
information and byte differences are not billed token savings.

**Abandon the global-scan candidate.** An initially tested variant continued to
later files to prioritize globally exact names. On a registered saturated
`difference` prefix over date-fns `src`, it increases filesystem reads from 65 to
1,479 and median wall time from 560 ms to 7,180 ms (three repetitions). Its
full raw observations and patch remain archived. Local build/check activity
overlapped part of these timing runs; the deterministic read-count regression
and large latency change motivate rejection, not a calibrated performance ratio.

**Keep bounded priority.** The retained variant stops between files at eight
candidates, while considering all symbols in the already parsed current file.
The repeated saturated-prefix check reads 65 files in both arms, with medians
480/444 ms; this small timing difference establishes no speedup. Single-file
timings vary even for unchanged text controls, so no general duration gain is
claimed. The first three broad exact/prefix/miss controls read all 1,479 files in
both versions and take seconds: pre-existing cost, not a fixed mechanism.

Remaining boundaries: a later file can still be hidden after eight earlier
partial matches; explicitly scoped queries recover it. Auto mode additionally
restricts syntax candidates to bounded lexical-hit paths. `find` remains absent
from the syntax index: Lodash line 9280 declares `var find = createFind(findIndex)`.
Changing result ordering cannot create that missing binding. No new completeness,
semantic identity, validation or whole-task success claim follows from this patch.

## Validation and next hypotheses

The runtime build and 57 focused tests pass, including unread/stale edit refusal,
homonyms, qualified names, explicit scopes, lexical engines and existing compiler
reference/rename guards. Re-run after narrowing the initially adverse variant.

1. Exact priority avoids prefix displacement. Retained local evidence supports
   this mechanism; compare full assigned model success and resources at matched
   audit quality, recording adoption rather than selecting exposed runs.
2. A reusable, source-bound declaration index could resolve names across files
   without repeated full parsing. Compare cold/warm exact recall, read counts,
   cache hits and invalidation on edits/additions/deletions. Stale identities,
   memory and initialization time are regression risks; not implemented.
3. Index factory-initialized bindings such as Lodash `find` as declarations with
   honest kind/source ranges. Compare known missing and fresh binding probes,
   body/read coverage and patch routing. A callable value is not automatically
   a function declaration; avoid granting unsafe symbol-body edits. Not implemented.

Complete raw data: `replay.json.gz` and `retained/replay.json.gz` (234 observations
each), plus both `latency-regression-replay.json.gz` (six each). Preserve all
480 local observations, including misses and adverse timings; do not pool the
two candidate versions. Registrations, summaries, patches and test counts are
beside this report. The separate F24 study prepares genuinely cross-file tasks;
its model comparisons are budget-stopped before any request.
