# Truthful formatter evidence origin (local F4)

The journal previously labelled formatter-derived evidence as "prettier --check ...", although no such check ran. The preregistered replay intercepts only argv, exit and input/output hashes while delegating unchanged arguments/input to actual pnpm. Its deterministic local formatter echoes already formatted bytes; this verifies routing and provenance, not Prettier's formatting quality.

Replace the synthetic command with evidenceOrigin="formatter_output". Keep source/output hash binding, status and per-file scope. Include origin plus paths in identity/grouping only when command/task ID are absent, preserving ordinary and legacy records. No changes to executed commands, admission rules or user acceptance. Formatter-derived lint lacks a task ID and cannot by itself make completion verified.

Identical four-file regression tests: reference 243/244, candidate 244/244; the sole baseline failure is the new provenance/scope test. Two unchanged formatter calls in each arm execute zero --check commands; synthetic check labels fall from 2 to 0 and explicit derived origins rise from 0 to 2. Both same-revision scopes remain available after journal rehydration, sources are identical and no changes are recorded. Runtime/runner builds and package-local ESLint pass. Only executable light-task-runner.js and session-journal.js change; raw logs and SHA bindings are retained.

Retain this local reliability repair. Completion was not invoked; no model calls, global task-quality or resource improvement is established. Historical records remain unlabelled, and full invocation/environment provenance remains an open proposal. T4 uses immutable earlier versions without F2/F3/F4.
