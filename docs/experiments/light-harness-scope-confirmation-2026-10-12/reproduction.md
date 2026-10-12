# Reproduction boundaries

The frozen model, effort, provider, URL, limits and task instructions are in each panel's `protocol.json`; exact runtime/prompt/runner/shared-core/upstream/lock hashes are in `execution-bindings.json`. Source maps resolve local build labels to published identical Git trees. Preserve original results and raw traces; run new replications in a separate campaign directory and preregister their own outputs before calls. The saved driver refuses to overwrite its campaign. Do not overwrite bindings after outcomes.

For a fresh Linux Node 24.19.0 setup, restore pinned date-fns commit `313b902b9a72c64501074db9bc2b9897d2db5140` and Lodash commit `f299b52f39486275a9e6483b60a410e06520c538` to the protocol source paths. Restore each exact lock from `environment-archives/`, verify `environment-inventory.json` hashes, then use `npm ci` for date-fns and `npm ci --ignore-scripts` in the separate minimal Lodash dependency directory. Symlink Lodash's `node_modules` to that minimal directory. The original Lodash manifest/build/FP suite is not the dependency installation or grading scope.

Install the repository's pinned workspace dependencies/patches using `pnpm-lock.yaml`. In separate checkouts build runtime source `5155d3d9` for baseline and the published source-map candidate for each intervention. Compile `packages/agent-runtime/tsconfig.json`, copy prompt resources with its bundled script, and build the existing benchmark runner. Freeze built `dist` trees with `freeze.py`; the runner's `@blame/agent-runtime` link must resolve to its own arm. F12 reuses the immutable pre-F11 baseline, not F11. Compare every built tree/Node/SDK/compiler/dependency version to execution bindings before running; differing hashes are a distinct replication environment, never silently treated as the original campaign. The study archives source/trace proofs and compiled hashes, not a machine/container image.

With the configured Blame credential and inherited proxy/CA settings, run `scope-followup/run.py diagnostic`, then `scope-followup/run.py confirmation`; the latter charges the former against their shared USD 0.30 ceiling. `command-wait/run.py` charges both completed panels before its USD 0.015-per-trial diagnostic. Missing costs reserve their own panel limit; retain every budget-stopped or unexecuted case. Do not raise limits after observing results. Model routes remain free; no reference patch or verifier feedback enters their workspaces. Seeded tasks have a fresh first commit containing the fault, so reading their own initial HEAD is legitimate source inspection.

Independent score, actual agent post-final-edit checks, runtime success, admitted scope and audited completion remain separate. Complete recorded source/tool-input review is required before using the shared publisher. `postprocess.mjs` only extracts mechanisms, validation facts, unchanged journals and untracked added-test bytes; it does not repair source or replace a score. Archive and verify all raw artifacts with:

```
python tools/terminal_bench/scope-followup/verify-evidence.py docs/experiments/light-harness-scope-confirmation-2026-10-12
```

Repeating model trials is not deterministic replay. Local mechanism/evaluator controls and byte-level evidence verification require no model budget; arbitrary provider retries/cache and future global task success remain unestablished.
