# POSIX missing-tool recovery (local only)

F27 exposed two completed-code/failed-session RxJS trials: after the exact requested checks passed, the model selected optional `lint_src`; the pinned minimal environment has no TSLint. `sh: 1: tslint: not found` (exit 127) was classified as a code failure. Repeated `finish_task` calls could not deliver the result. The original paid outcomes remain unchanged.

The limited runtime change recognizes a complete `sh`/`dash` missing-executable line only with exit 127, including catalog tests. Existing unavailable-validation handling then allows an **unverified** completion, without admitting validation or satisfying a missing required check. Ordinary “symbol not found” diagnostics and shell-looking text with exit 1 remain code failures. No completion guard is removed. Other shells/locales and diagnostic spoofing are not solved.

Before the change, two new missing-lint integration cases fail and two negative controls pass. Afterward, all 275 related tests pass; the final required-check suite passes 22/22 after adding a fifth integration case for a missing required test runner. TypeScript build and changed-file ESLint pass. The separate four-case runtime replay confirms two blocked/unavailable sessions become unverified completions; both actual code failures remain blocked, with no automatic retry loop. `validation.json` binds original logs and both replay outputs by SHA-256.

Decision: **retain** the narrow classification repair. It fixes a reproduced recovery mechanism; its effect on model success and efficiency remains unmeasured. F27 uses its original frozen runtime throughout and supplies no model comparison for this later patch.

Reproduce (zero model requests), after building the runtime:

```sh
node tools/terminal_bench/navigation-evidence/posix-tool-controls.mjs .blame/research/navigation-evidence-native2/frozen/f27/modified/agent-runtime/dist before
node tools/terminal_bench/navigation-evidence/posix-tool-controls.mjs packages/agent-runtime/dist after
node --test packages/agent-runtime/dist/harness/light-required-checks.test.js
```

The first command requires the archived local F27 runtime. Source commits and exact input hashes are in `validation.json`; raw integration logs retain the pre-fix failures separately from passing regressions.
