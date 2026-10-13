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
