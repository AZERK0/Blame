# TypeScript member edit boundaries (local only)

Two F27 reference lifecycle runs attempt `insert_after` with `  cancel?(): PromiseLike<void>;` after an observed reader method. The parser represents the original semicolon as a sibling, so insertion before that separator produces invalid syntax and an atomic rejection. This current harness mechanism, alongside model choices, causes avoidable recovery work. Original paid outcomes remain unchanged.

The isolated boundary repair includes the following semicolon/comma in TypeScript method-signature boundaries. It also recognizes `object_type` as a member container: an edit of a method in an object type alias must retain sibling methods instead of climbing to the whole alias. Unterminated signatures retain their existing boundary. Other languages and the stale/read/atomic-write guards are unchanged.

Seven of twelve new integration cases fail before the repair; all twelve pass afterward. They cover delete, replace, insert-before and insert-after on terminated interface/type-alias methods and unterminated optional methods with Unicode/CRLF. All 266 related regression tests, TypeScript build and changed-file ESLint pass. A separate zero-model replay of the two exact observed insertion shapes on isolated copies of original RxJS `types.ts` confirms both previously rejected edits now succeed, preserving every other byte. No model trial is repaired, rerun or rescored. Logs and original/candidate source hashes are bound in `validation.json`.

Decision: **retain** the limited boundary repair. This demonstrates local editing reliability, not measured model task-success or token savings. F27 keeps its earlier frozen runtime throughout. Parent/candidate classification differences are not exercised by these edit-only controls. Further grammar forms remain untested.

Reproduce after building the current runtime (zero model requests):

```sh
node tools/terminal_bench/navigation-evidence/member-boundary-controls.mjs .blame/research/navigation-evidence-native2/frozen/f27/modified/agent-runtime/dist before
node tools/terminal_bench/navigation-evidence/member-boundary-controls.mjs packages/agent-runtime/dist after
node --test --test-name-pattern='syntax wrappers in .*signature.ts' packages/agent-runtime/dist/harness/light-friction.test.js
```

The original RxJS checkout and archived F27 runtime are local prerequisites, pinned in the F27 registration. Private replay copies are deleted after inspection.
