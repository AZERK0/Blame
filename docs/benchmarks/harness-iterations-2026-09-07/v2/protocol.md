# Diagnostic V2, registered before execution

Nine trials, one group: gcode-to-text, cancel-async-tasks, build-cython-ext; each receives Cline, Blame V2 and Blame V1 in that configured arm order. Harbor may interleave tasks. Two concurrent Docker trials, one attempt, zero retries. All tasks were seen before this campaign. This is diagnostic evidence, not a held-out superiority claim. Cython repeats contemporary comparison after the preserved V1 Cline transport failure; this run does not replace that outcome.

Same openai-codex/gpt-5.6-luna, high reasoning, 64 iterations, runtime nominal 900 seconds; official task timeouts and Docker resources unchanged. Cline native SDK 0.0.81 uses the V2 runner, with its native prompt and tools. This is not the standalone Cline extension. BLAME_ISOLATED_ENVIRONMENT=true for all arms.

Before: V1 archive 37fd65a0dd3e6ff5fb241ccd388bec16766833a67e8c2cbd7d44a41610c8ca88. Final: newly frozen archive from source 8ef307f4; SHA256 recorded in manifest. No bundle, adapter or task edits during this campaign. Source changes after freezing cannot affect these archives.

Primary observations: official success, agent duration, input/output/cache tokens, billed cost, request count, blocked edits, model transport errors, image-content routing, cancellation behavior. Tokens count input plus output, including cached input; cost is the provider-reported estimate, not an independently invoiced charge. Missing usage stays missing. Preserve all failures; identify infrastructure errors without relabeling official reward. Compare joint successes separately and label their selection bias. Audit tool traces for oracle/verifier access. No benchmark-specific rules or task solutions enter the harness.

V2 adds transitive standalone packaging, managed relay context, native local images, source positions for embedded diagnostics, streamed snapshot hashes, and two upstream prompt instructions to group independent inspections and check requested behavior/final state. It adds no LLM router, retries or downstream evaluator. Improvements must survive subsequent independent task selection before any broad claim.
