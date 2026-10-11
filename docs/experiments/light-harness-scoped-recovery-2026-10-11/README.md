# Scoped patch recovery consistency (local F3)

Scoped patch context failures become SymbolResolutionError, whose response branch previously skipped the existing patch recovery helper. Two actual executor cases (export modifier outside AST range, ambiguous repeated context) reproduce missing recovery; both already permit guarded exact body repair. The protocol and real replay were committed before implementation, with model budget zero. First fixture draft used a path selector; correcting it to an observed sN alias preceded registration/implementation.

Reuse the existing patchFailureRecovery only when there are no symbol candidates. Preserve candidate-list priority and every source, scope, syntax, observation, loop and completion guard. T4 model versions remain untouched; both local F3 arms share F1/F2 and pending T4 no-op guidance.

Identical regression tests: reference 242/243, candidate 243/243. Recovery availability improves from 0/2 to 2/2; refusals remain nonmutating with unchanged revision/journal, out-of-target patches remain blocked and exact body repair preserves the neighboring function in both arms. Runtime/runner builds and package-local ESLint pass; sole executable compiled change light-edit.js. All replay/test logs and SHA bindings retained.

Retain for consistent recovery information only. This is not evidence that a model follows the hint, completes more tasks or uses fewer resources. T4 canary warns that exposed recovery advice can be ignored. Model comparison for F3 remains unexecuted.
