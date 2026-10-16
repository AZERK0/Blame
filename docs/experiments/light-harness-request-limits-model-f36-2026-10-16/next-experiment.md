# Next experiment proposal: dependency declarations

This is a proposal, not an implemented route, a frozen new-task panel or a measurement. Finish the fixed F36 assignments and audit before changing the common runtime again.

## Observation and causal limit

F31 `2-fast-glob-dynamic-filter-baseline` calls22–24 attempt a dependency `.d.ts` read and two searches, all refused; calls29–31 move to shell inspection, including a guessed nonexistent file. The corresponding candidate calls24–25 also refuse `.d.ts` reads before shell discovery. The original SHA-bound inputs remain in F31 `tool-ledger.json`. Current `LightWorkspace.readPath` still calls `assertMutableWorkspacePath`, which excludes node_modules from both ordinary navigation and edits. This is still present, not a historical mechanism already repaired.

Compiler references/rename already resolve configured project identity. Their worker reads dependencies for the compiler but excludes dependency locations from returned references. The next change should reuse that bounded compiler service, rather than introduce another index or expose arbitrary dependency paths.

**Hypothesis:** resolving a local imported identifier to its installed declaration, with package/version identity and bounded read-only output, reduces failed reads and guessed paths while preserving or improving audited success. Declarations describe types and documented contracts. They cannot by themselves establish callback exception propagation or other dependency runtime behavior; the historical traces also inspect implementation JavaScript, so this route cannot be credited with eliminating all their shell work.

## Smallest implementation to evaluate

Keep the five primitives. Add an explicit declaration view to `read_code`, anchored in an observed local import/member and resolved by the configured JS/TS compiler. Return declaration text, source/package version, project identity, warnings and bounded continuation. Support the observed namespace import/member case as well as named aliases. Treat overloads/augmentations and ambiguous targets explicitly.

Dependency output is read-only: it grants no writable alias, observation coverage for edits, rename authority or validation admission. Ordinary dependency-path navigation/edit restrictions remain. Validate canonical paths and package ownership, including pnpm layouts; reject arbitrary symlink escapes and metadata/secret targets. Reuse worker timeout/memory/read budgets, cancellation and source/dependency footprint checks. Missing configuration/declarations must produce an honest bounded fallback, never guessed identity.

## Local gate before any model trial

Use controlled modules with lexical decoys, named/namespace/re-export aliases, overloads, conditional types/exports, Unicode offsets and dependency replacement. Include ambiguous/unresolved imports, stale package/config/declaration content, cancellation/budget exhaustion, and symlink/protected-path negative cases. Verify byte bounds, complete identity and continued refusal of dependency edits. Then replay only the historical declaration lookups as known diagnostics; shell-runtime investigations remain a separate requirement. More emitted bytes and slower compiler startup are adverse results to retain.

## Confirmation design to freeze next

Select previously unobserved cross-file tasks on an additional larger JS/TS project before model outcomes, with source/task selection rules independent of expected savings. Do not provide target symbol names or file allowlists that solve navigation when the user task would not contain them. Prepare the behavioral oracle and positive/negative controls independently. Archive upstream revision and dependencies; verify the configured compiler project fits the declared limits. Accept documented command aliases prospectively unless exact invocation is itself required; still require faithful reporting of the actual invocation and final-source results. Do not retroactively relax F36's literal criteria.

Compare reference Light, declaration-view Light and integrated Cline with identical actual model/effort, shared output cap policy, environment and budgets. Use rotated order and dependent repeats, keep failures/timeouts/missing consumption and separate official, behavioral, audited and admitted results. Isolate this one navigation mechanism; changing edit guidance or prompts at the same time would confound attribution. Primary criterion is audited completion; assess repaired lookup count, identity, output/context bytes, billed tokens/cache estimates, cost and duration second. Report all-attempt resources and paired-success comparisons separately. A neutral or adverse model result is grounds to retain only an independently useful correctness contract, or to abandon the route if its costs dominate.
