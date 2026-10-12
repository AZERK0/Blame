# Reproduction

Verify archived evidence without a model:

```sh
python tools/terminal_bench/scope-followup/verify-evidence.py docs/experiments/light-harness-validation-refresh-confirmation-2026-10-12
```

The execution bindings preserve the original compiled runtime/runner hashes and local build labels. `source-map.json` maps those labels to published commits with identical trees: F13 baseline `d152b1ad`, F14 `e0dce84a`; the original driver/protocol binding checkpoint is `05963938`. Later release guards are separate and were not in the model trial. Do not rebind or overwrite an original campaign to make it fit newer code.

For a new replication, use a separate checkout/workspace and new campaign files. Restore date-fns 4.1.0 at `313b902b9a72c64501074db9bc2b9897d2db5140`, its archived package-lock and pinned platform/toolchain. Build each published source in isolated clean dist directories with TypeScript 5.9.3, copy prompt resources, freeze both arms with the registered freezer and the runner's own runtime dependency link. Select a new artifact root in a copied driver/freezer and record that derivative's hash before trials. Copy the original task list and exact argv; bind the rebuilt versions and current configured environment explicitly. A new binding is a new campaign, not an amendment to these outcomes. Run the known diagnostic before confirmation; preserve its unchanged pre-confirmation accounting input. Cline uses the baseline snapshot's integrated 0.0.82 default tools.

Original model settings: `gpt-5.6-luna`, high effort, openai-codex through the configured Blame API; Node v24.19.0; date-fns TypeScript 5.4.5, Vitest 1.3.1 and esbuild 0.20.1. The driver is `tools/terminal_bench/validation-refresh/run.mjs` (`bind`, `run`, `analyze`, `prepare`, `score`, with diagnostic/confirmation). Raw artifacts, all added test bytes and journals are SHA/byte bound. Preserve the configured credential/proxy without archiving it.

Use at most USD 0.02 per trial, 24 iterations, 480 seconds plus a 25-second group watchdog; phase ceiling USD 0.24, each panel USD 0.12. Missing cost reserves the trial ceiling, missing cache stays unknown. Review all effective started/finished actions and final test source before publishing audited completion; independent functional checks cannot stand in for post-final-edit agent invocations. No solution retrieval, source repairs or oracle feedback. The original source seed exists in the first task commit; no prior correct solution revision is exposed.

This environment has no frozen container image. npm's version is observed only after trials. Exact service-side model revision, complete per-request cache accounting, hidden retries and invoiced cost are unavailable. Reproduction fixes disclosed inputs and evaluation, not stochastic generations or undisclosed backend state.
