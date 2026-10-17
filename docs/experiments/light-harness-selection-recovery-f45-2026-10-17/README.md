F45 — retain narrow test-selection recovery; local evidence only

Known diagnostic: F44 2-remeda-take-counts-scope calls remeda:test from packages/remeda with the root-relative filter packages/remeda/src/take.counts.test.ts. Vitest reports no test files. The shared Light implementation misclassifies this as a code failure, blocking four finish attempts despite later full package passes; the model reaches 48 iterations. F44 retains this failure and all its cost.

Correction after all F44 workers: recognize a single supported literal Vitest 1–3 invocation (optionally after a successful literal tsc command), no-files diagnostic, exit 1, no runner summary/compiler/setup conflict or interruption. Report selectionFailure=no_test_files and a command category with the effective cwd. Retain the failed invocation, unknown counts, unverified scope and any missing exact required check. Do not silently change selectors or erase real failures. Avoid automatic unchanged-selection retries; a changed source is reconsidered. Unsupported/ambiguous output remains conservative.

baseline-replay.json and candidate-replay.json apply the same archived patch without repairing it, reconstruct journal changes explicitly, and execute the same four required checks, original bad selector and full package task (3,862 passing tests). Reference blocks both repeated finish attempts. Candidate finishes unverified with zero extra validation runs; explicitly requiring the bad selector still leaves check:exact-selection missing. The endpoint continues to fail the scalar semantic witness in both arms. This is a local mechanism improvement, not a recovered model task or measured token saving.

vitest-controls.json executes real pinned Vitest: a genuine assertion failure still blocks completion after another selector passes. A separate type-gap fixture passes Vitest with Type Errors no errors while explicit TypeScript compilation fails TS2322; ordinary *.test.ts files are not selected by the default type-test pattern. That diagnostic is post-hoc, does not repair any model result, and supports keeping runtime/type claims separate.

Validation: 61 initial targeted controls passed before final command hardening; the final full runtime passes 941 tests with two skipped; runner 37/37; changed-runtime ESLint and repository line budgets pass. verification.json binds artifact and runtime-module hashes and independently checks preserved failures, obligations, unchanged source and real assertion blocking. The 19 new automated cases include unknown/duplicate/contradictory output, cancellation, actual failed-case summaries, retained journal records and stale-source refresh. Logs and checksums accompany local-validation.json.

Reproduction after building the desired runtime and preparing pinned F44 inputs:

    node tools/terminal_bench/validation-selection-study/replay.mjs /absolute/runtime/dist/harness /absolute/new-result.json
    node tools/terminal_bench/validation-selection-study/vitest-controls.mjs /absolute/runtime/dist/harness /absolute/new-controls.json
    node tools/terminal_bench/validation-selection-study/verify.mjs

Replay output must be new. Use an isolated workspace/process and the F44 dependency lock; scripts never make model calls. The archived baseline uses F44 frozen reference (compiler-membership capture disabled); current source has removed that unused prototype. Do not substitute local replay results for a fresh isolated model confirmation. Next: preselect unseen multi-package tasks and compare this correction alone against its reference and integrated Cline, retaining unused diagnostics and all costs.

Final runtime code: bfc1f511. A local replay setup attempt correctly refused an already-used npm cache before executing checks; its log is retained. The script now creates a unique temporary parent on every run (99cb85b4), retaining isolated empty caches. Initial pre-hardening receipts remain separate; final receipts record exact executed runtime hashes and researcher code commits.
