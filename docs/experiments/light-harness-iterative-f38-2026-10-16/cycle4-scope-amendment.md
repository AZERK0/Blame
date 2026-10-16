# F41 local counterexample and scope correction

Before any F41 model trial, the first classification repair passed its eight controls but admitted package-wide source verification from a compiler-only script. An added counterexample changes a TypeScript file excluded by that compiler project: compilation still passes and the first repair incorrectly marks the source verified. The counterexample fails1/1 and is retained. This regression was caught before the production repair was committed or pushed.

The refined treatment distinguishes successful required execution from source coverage. Newly recognized compiler-only catalog tasks are labeled `invocation_only`; their successful journal record has no inferred package paths, and the label survives the direct result and `@checks`. They can satisfy an exact required compiler invocation without certifying excluded source or runtime behavior. Existing named typecheck/build scope heuristics are unchanged and remain a limitation; a future compiler-footprint scope mechanism is a separate hypothesis.

The expanded gate includes the excluded-file counterexample, plus the original hook/failure/freshness/compound controls and existing compiler invariants. Historical F38b admission remains untouched. This amendment records a counterexample-driven refinement, not a retrospective relaxation of model grades.
