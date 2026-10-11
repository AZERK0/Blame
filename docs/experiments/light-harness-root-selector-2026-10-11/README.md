# Root manifest task selector repair (local F5)

Existing package matching strips only a slash-prefixed package.json suffix. After workspace normalization, package.json and ./package.json therefore fail to select the root, although . and ./ work and nested manifests work. Direct real-command diagnosis and zero-model protocol precede implementation.

Recognize either start-of-string or slash before the exact package.json basename. No command, catalog, task identity, argument, validation, completion or scope policy changes. Canonical root task remains build; child folder/manifest still execute the failed child, lookalike suffixes and outside-workspace selectors stay blocked.

Identical four-file regression set: reference 244/245, candidate 245/245, only the newly added root-manifest test fails on reference. Its journal accessor typo was corrected before freezing or changing production; the initial protocol hash remains historical. Actual root selector variants accepted improve from 2/4 to 4/4, while both child selectors still fail their real exit-9 command. Source-matching finish replay is unchanged: current required root evidence admits technical verification, a failed child still blocks completion. Runtime/runner builds and package-local ESLint pass; only executable light-task-runner.js changes. Raw logs, replay and source hashes are retained.

Retain the interface correctness repair. These are local command/finish fixtures, not model-completed user tasks or proof of general acceptance. Model quality, tokens, cache, cost and duration benefit remain unmeasured; frozen T4 arms exclude F2/F3/F4/F5.
