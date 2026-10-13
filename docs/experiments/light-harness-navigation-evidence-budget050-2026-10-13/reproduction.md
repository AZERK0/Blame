# USD 0.50 diagnostic rerun

Registered before any paid rerun. Exact old tasks; these are known diagnostics. The only shared source change is the saved per-request cap patch. F20 compares the original event-reporting feature, not later release-only repairs.

```sh
export BLAME_STUDY_VARIANT=budget050
python tools/terminal_bench/navigation-evidence/prepare-rerun.py
node tools/terminal_bench/navigation-evidence/wire-cap-preflight.mjs 8192 .blame/research/navigation-evidence-budget050/frozen/{f18,f19,f20}/{baseline,modified}/agent-runtime/dist
for panel in f18 f19 f20; do
  node tools/terminal_bench/navigation-evidence/controls.mjs "$panel"
  node tools/terminal_bench/navigation-evidence/run.mjs bind "$panel"
  python tools/terminal_bench/navigation-evidence/run.py "$panel"
done
```

Do not overwrite existing freezes or trials. Publish and inspect raw inputs, all lifecycle events, final-source checks and SHA-bound manual audits with the existing large-project evidence scripts. Frozen bindings include each source archive, identical common patch, compiled runtimes, prompts, SDK/runner, toolchain, dependency locks and upstream archives. Provider revision, hidden retries, full cache accounting and invoices are not available. The configured proxy and CA remain enabled.

After all SHA-bound manual audits, publish each panel with `large-project/publish.mjs`, preserve journals/new sources with `navigation-evidence/postprocess.mjs`, run `navigation-evidence/finalize-artifacts.mjs` and `required-checks/obligation-audit.mjs`. Verify each with `scope-followup/verify-evidence.py`. Run `BLAME_STUDY_VARIANT=budget050 node tools/terminal_bench/navigation-evidence/summarize-rerun.mjs` for financial totals and request-cap observations. This helper retains budget/cap exceptions rather than rejecting or replacing them.

Current results: all 18 official/audited trials pass, estimated USD0.147765. No output reaches8192 (observed peak3039); serialization is tested, causal cap activation is not. Case proof improves while F20 reference efficiency worsens; header reading remains unused. Do not merge these performance cohorts or the old campaign into one code-version claim.

Native LaTeX opening failed with a closed connection; the compiler returned `No handler registered for tool: codex_app.compile_latex_document`. Source remains saved and editable. Updated PDF compilation is unverified; no local TeX installation was attempted.
