# Reproduction

Use a fresh checkout / empty study artifact root; freeze and trial commands refuse
to overwrite earlier observations. Node 24.19.0, npm 11.9.0, workspace locked
dependencies, TypeScript 5.9.3 and integrated SDK 0.0.82 are recorded in bindings.
The existing source/dependency roots can be reused. Otherwise clone date-fns into
`.blame/research/npm-formatter-confirmation/date-fns`, check out the registered
commit, and install its committed npm lock. Verify the archive/lock hashes and
installed TypeScript5.4.5, Vitest1.3.1 and esbuild0.20.1 against bindings before
interpreting results. Lodash local probes use the separately registered
4.17.21 commit under `.blame/research/scope-followup/upstreams/lodash`.

Build workspace core/runtime/benchmark runner with the installed toolchain,
including `packages/agent-runtime/scripts/copy-prompt.mjs`. Do not update locks
or infer that newly resolved dependency versions reproduce these observations.

```sh
BLAME_STUDY_VARIANT=declarations node tools/terminal_bench/navigation-evidence/prepare-declarations.mjs
BLAME_STUDY_VARIANT=declarations node tools/terminal_bench/navigation-evidence/multifile-controls.mjs
BLAME_STUDY_VARIANT=declarations node tools/terminal_bench/navigation-evidence/run.mjs budget f24
BLAME_STUDY_VARIANT=declarations node tools/terminal_bench/navigation-evidence/run.mjs bind f24
```

Preparation rebuilds baseline from the immutable registered commit and applies
the single archived candidate patch with a checked, content-hash-verified step;
both builds exclude tests identically. The complete runtime trees also freeze
tool schemas and prompts. Local controls never call a model and do not expose
their oracle edits to model workspaces. Original controls remain separate from
new model tasks.

To repeat the retained local query panel, use fresh output copies of its registered
`protocol.json` and `latency-protocol.json`, with explicit frozen runtime inputs:

```sh
node tools/terminal_bench/navigation-evidence/declaration-replay.mjs \
 .blame/research/navigation-evidence-declarations/frozen/f24/baseline/agent-runtime \
 .blame/research/navigation-evidence-declarations/frozen/f24/modified/agent-runtime \
 /absolute/path/to/fresh/local-output
```

For each separately registered saturated-prefix repetition, `declaration-replay.mjs
worker RUNTIME PROJECT CASES_JSON ARM REPETITION` runs the exact cases in a fresh
process. It writes complete observations to stdout; keep all arms and repetitions,
not just favorable cases. Cache order is recorded; filesystem reads count the
complete search operation, not parser-only reads. Local timestamps do not measure
model duration or billed tokens.

The model runner uses the configured credential without archiving its value.
Model/provider/API URL/effort must equal protocol fields; preserve session proxy
and CA settings. Bindings are checked again before every admission. The current
registration has cumulative budget USD0.50 and stops before any paid request.
Do not reset the prior missing-response reserve. A funding amendment must name
its scope, retain earlier financial uncertainty, register a new campaign root,
and bind it before dispatch; never edit old paid observations into a new cohort.
The existing `run.py f24` wrapper and `run.mjs analyze f24` retain assigned order,
official outcomes, independent checks, watchdogs, events, diffs and usage. The
configured output limit is nominal on OAuth; the common request-byte guard and
full catalog request allowance remain necessary.

After an admitted campaign, inspect every final-source command and final summary,
separate runtime success from audited user satisfaction, flag solution retrieval,
and leave `auditedCompletion` null until this review. Resource comparisons require
both audited completion and reconciled accounting. Archive wire attempts and raw
events, retain missing usage, report cache fields individually, and label catalog
cost estimates separately from invoices. The prior common wire observer captures
schemas/prompt and response-usage metadata without saving credentials or raw
request bodies. No paid campaign has reached this stage for F24.

Verify the saved zero-model evidence and inventories:

```sh
node tools/terminal_bench/navigation-evidence/audit-declarations.mjs
```

The study's LaTeX source is updated; the built-in editor/compiler is unavailable
on this host, so PDF compilation remains unverified.
