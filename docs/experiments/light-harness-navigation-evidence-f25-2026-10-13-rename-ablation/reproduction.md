# Compiler-rename availability ablation (F25)

Reuse the exact pinned upstream, dependency locks and toolchains in the F24 EUR1
reproduction. Both known tasks and their private binding manifest are unchanged.
Current Light source is pinned to `8bda7669`; only the research baseline receives
the archived one-action rejection patch. This patch is never installed in production.
Both prompts, schemas, references, reads, non-rename edits and output policy match.
Keep inherited credentials/proxy/CA; never print secrets or reset the cumulative
accounting. The prior missing-response reserve is retained.

```sh
export BLAME_STUDY_VARIANT=rename-ablation
node tools/terminal_bench/navigation-evidence/prepare-rename-ablation.mjs
node tools/terminal_bench/navigation-evidence/rename-ablation-controls.mjs
node tools/terminal_bench/navigation-evidence/run.mjs budget f25
node tools/terminal_bench/navigation-evidence/run.mjs bind f25
python tools/terminal_bench/navigation-evidence/run.py f25
```

Use new source/freeze/trial roots: none overwrite old outcomes. `prepare ... verify`
rechecks an existing build without rebuilding; no rebind of a dispatched cohort.
Restore prior F21-F24 working analysis and wire ledgers for the shared budget check;
public archives retain their original rows and whitelisted wire metadata. Planned
assignments remain unexecuted if admission cannot reserve another USD0.27.

Local controls use private oracle patches to verify fallback feasibility, blocked
rename zero writes, unchanged navigation, and equivalent final source bytes. Models
receive only unchanged task instructions and initial source, never those patches,
previous artifacts or verifier results. All paid outputs receive independent types,
selected/full tests, source/alias/homonym/comment protection checks and unblinded
recorded-action/source review. Keep official, functional, actual agent validation,
strict reporting and harness admission separate. Count skipped bodies separately
from active executed cases. Preserve timeouts, failed commands and missing usage.

The unchanged prompt still advertises rename. Thus this estimates removal of that
capability including its explicit blocked-action recovery, not an optimized patch-only
prompt. Two known task clusters and two repeats cannot establish generalization.
Native SDK is a contemporaneous control; older cohorts contribute costs only.

The original paid driver is `fe7bc5f5`; later edits are postprocessing or separate
local fixes. Restore that driver revision to reproduce original prompt/input Git
metadata. Actual wire prompts vary by workspace root; compare the archived
workspace-normalized contract, never literal per-workspace hashes. Original F25
stays11/12. Tail registration `57d99cad` is separate and has a different initial Git
HEAD in its prompt; do not silently apply the later taskInputCommitAtUTC fix to it.

```sh
node tools/terminal_bench/corpus/light-study-tool-lifecycle.mjs .blame/research/navigation-evidence-rename-ablation/f25
node tools/terminal_bench/large-project/publish.mjs .blame/research/navigation-evidence-rename-ablation/f25 docs/experiments/light-harness-navigation-evidence-f25-2026-10-13-rename-ablation diagnostic
node tools/terminal_bench/navigation-evidence/postprocess.mjs .blame/research/navigation-evidence-rename-ablation/f25 docs/experiments/light-harness-navigation-evidence-f25-2026-10-13-rename-ablation
node tools/terminal_bench/navigation-evidence/publish-wire.mjs .blame/research/navigation-evidence-rename-ablation/f25 docs/experiments/light-harness-navigation-evidence-f25-2026-10-13-rename-ablation
node tools/terminal_bench/navigation-evidence/summarize-rename-ablation.mjs
node tools/terminal_bench/navigation-evidence/finalize-artifacts.mjs f25
node tools/terminal_bench/navigation-evidence/verify-rename-ablation.mjs
python tools/terminal_bench/scope-followup/verify-evidence.py docs/experiments/light-harness-navigation-evidence-f25-2026-10-13-rename-ablation
```

All commands require `BLAME_STUDY_VARIANT=rename-ablation`. Inspect every raw
started/finished input, complete final report, successful post-final-edit checks,
transient patches and final source before recording SHA-bound manual decisions
with record-review.py. The integrity verifier has no favorable-outcome requirement.
A single administrative continuation must skip the complete three-arm paired helper;
its own summary discloses the prompt metadata difference and preserves all fields.
