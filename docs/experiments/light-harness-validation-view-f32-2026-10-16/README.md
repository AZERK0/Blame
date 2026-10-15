# F32: bounded validation-summary presentation

This is an **isolated prototype**,with **zero paid model calls**. Its temporary
production integration was reverted after the recorded replay showed no gain.
It is
separate from every frozen F31 model runtime. It cannot establish model adoption,
task-success improvement, token savings or native Cline behavior.

The change preserves raw detected Node/Jest/Mocha/QUnit aggregate lines lost in
the middle of long validation output. The index names full-log line locations,
does not combine stages, says “not verification”, and marks omitted lines. The
existing900-character view and4000-character failure/fallback view remain bounded;
short output up to1200 characters and any Node-event caption retain their prior
behavior. Full logs, safe directory checks and file permissions are unchanged.
Only `validation-output.ts` and the forced failure-view call in
`light-task-runner.ts` change. Execution, original observations, counters, source
bindings, environment evidence and admission logic are unchanged.

The controlled comparison has eight cases, including real successful/failed Node
commands, unknown pending, unverified admission, byte-exact logs and a symlink
fallback. An initial test-loader setup failure emitted CommonJS for a top-level
await fixture; both arms failed before any case ran. That attempt remains in
`setup-failure-module-format.json`, separate from the expected old-presentation
failures and from harness/model regressions. The loader now explicitly emits ESM.

Two other check-infrastructure observations remain separate. The host `pnpm`
status hook tried an unrelated workspace reinstall and aborted without a TTY
before compilation (`setup-failure-pnpm-status.json`); checks invoke the already
installed package TypeScript/ESLint tools directly,without reinstalling. A broad
built-dist scan finds two old phrase-ranking failures in the abandoned F29 test
whose source is absent. Both failures reproduce on the frozen pre-F32 runtime
(`preexisting-dist-failures.json`); the original607-case run is retained in
`stale-dist-checks.json`. Current verification selects every source harness test,
excluding only stale compiled files absent from current source. It does not alter
the prototype tests,assertions or their recorded failures.

`recorded-replay.json` selects **all** F31 Light finished `run_task` observations
with a recorded `outputLog`, including unsuccessful trials. No outcome filter is
used. Archived logs are the bytes already redacted by the runner. Old presentation
must match each original tool result exactly. `public-replay.json` rerenders those
same public bytes; it does not rerun commands, recover solutions or modify grades.
Summary occurrences are not counts of successful tests. Identical repeated text
can make the includes-based visibility metric optimistic; full raw logs and line
locations support inspection.

Scanning a complete log adds CPU/allocation work and indexed summaries consume
space previously used by other diagnostic context. The fixed50-iteration,
alternating-order rendering measurement is local CPU time, not worker/model
latency. Output characters/UTF-8 bytes are not billed tokens. Large numbers of
summary lines remain explicitly partial. Arbitrary output can imitate a summary;
presentation never promotes it to admitted verification.

From the repository root, with the frozen F31 candidate runtime still available:

```sh
node tools/terminal_bench/validation-view-study/local-controls.mjs
node tools/terminal_bench/validation-view-study/replay.mjs --public-only
python tools/terminal_bench/validation-view-study/verify-replay.py \
  docs/experiments/light-harness-validation-view-f32-2026-10-16 \
  docs/experiments/light-harness-edit-boundaries-f31-2026-10-16
```

If the private F31 runtime is absent, build the committed pre-F32 source
`b8667f0e99c6ab5c5782d3d6bfdf91db9e58ba50` in a separate checkout, using the pinned
lockfile and recorded Node/TypeScript versions. Set
`BLAME_VALIDATION_BASELINE_RUNTIME` to that checkout's `packages/agent-runtime`
directory for both Node commands. The local-controls script creates private source
pairs from that commit plus the public `candidate.patch`; it never patches the
working source. Public log replay needs no model access or upstream workspaces.
The first private-log capture (without `--public-only`) is only for the original
study workspace, after the complete18-trial panel.

The candidate passed the eight local controls. Its current-source harness suite
reported583 cases (581 passed,2 skipped);compilation and lint passed. Yet all52 detected summary
occurrences were already visible in the17 recorded logs; no view changed and CPU
scan work increased. Keep it experimental and restore production; see decision.json
and rollback-checks.json. Local controls are necessary,not sufficient for promotion.
The production-checks.json artifact records the temporary candidate integration;
verify-candidate-integration.mjs is for that candidate checkout,not the restored source.
Invocation identity (npm wrappers versus resolved
scripts), native concurrency misuse and misleading final reports need separate
controls; this presentation change does not claim to fix them.
