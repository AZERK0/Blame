# Reproduce the raised-budget F24 panel

The task/source setup and dependency instructions are in the original budget-stopped
F24 `reproduction.md`; restore its pinned commits/locks and toolchains. This follow-up
uses the same baseline and modified runtime tree hashes. The paid driver is
preregistered/published at `2f160485`; later changes are post-processing only.
Protocol SHA and complete execution bindings are checked before every admission.

```sh
export BLAME_STUDY_VARIANT=declarations-eur1
node tools/terminal_bench/navigation-evidence/prepare-declarations.mjs
node tools/terminal_bench/navigation-evidence/run.mjs budget f24
node tools/terminal_bench/navigation-evidence/run.mjs bind f24
python tools/terminal_bench/navigation-evidence/run.py f24
```

Use an empty artifact root / fresh checkout. Freeze and trial roots never overwrite
previous observations. Keep configured credentials, proxy and CA trust; never
print credentials or replace them with reconstructed values. The user-authorized
EUR1 ceiling is cumulative; the conservative USD1 operational cap retains the
previous missing-response reserve. Preserve the archived FX reference, model and
effort, common request-byte guard, session allowance and full output reserve.
Do not silently reset costs or rebind an old paid cohort to newer code.

After all assignments, independently inspect all effective inputs, final source
diffs, post-final-edit validation and complete final reports. Record decisions with
`tools/terminal_bench/large-project/record-review.py`; distinguish the active-case
execution interpretation from code/commands success. Preserve any draft correction
as an audit amendment. Do not repair model workspaces or send verifier feedback.

```sh
node tools/terminal_bench/corpus/light-study-tool-lifecycle.mjs .blame/research/navigation-evidence-declarations-eur1/f24
node tools/terminal_bench/large-project/publish.mjs .blame/research/navigation-evidence-declarations-eur1/f24 docs/experiments/light-harness-navigation-evidence-f24-2026-10-13-declarations-eur1 confirmation
node tools/terminal_bench/navigation-evidence/postprocess.mjs .blame/research/navigation-evidence-declarations-eur1/f24 docs/experiments/light-harness-navigation-evidence-f24-2026-10-13-declarations-eur1
node tools/terminal_bench/navigation-evidence/publish-wire.mjs .blame/research/navigation-evidence-declarations-eur1/f24 docs/experiments/light-harness-navigation-evidence-f24-2026-10-13-declarations-eur1
node tools/terminal_bench/navigation-evidence/summarize-multifile.mjs
node tools/terminal_bench/navigation-evidence/finalize-artifacts.mjs f24
node tools/terminal_bench/navigation-evidence/multifile-query-replay.mjs
python tools/terminal_bench/scope-followup/verify-evidence.py docs/experiments/light-harness-navigation-evidence-f24-2026-10-13-declarations-eur1
node tools/terminal_bench/navigation-evidence/verify-multifile.mjs
```

The local query replay is a post-result diagnostic using independent source copies
and fresh alias sessions, never original model journals. It checks every actual
successful auto/symbol query; changing trajectory history or selecting only exposed
trials does not define a fresh model comparison. Full-study summaries keep both
strict report-matched and functional-source-matched cohorts, per-task/repetition
resources, missing cache fields, and financial totals separate from prior efficacy.
Raw artifacts remain SHA-bound, including failed commands and transient patches.
The CSV is a derived convenience view; complete request ledgers remain authoritative.

Use `verify-evidence.py` for exact compressed raw/source/journal bytes and
`verify-multifile.mjs` for wire contracts, task/model/effort/budget bindings, report
tiers and replay counts. Fixed counts in this verifier verify this saved cohort;
they are not population expectations or acceptance criteria for a new campaign.
