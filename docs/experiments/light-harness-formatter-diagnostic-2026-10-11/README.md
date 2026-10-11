F7: retain the isolated silent formatter diagnostic fix.

A real T6 failure returned a newline-only message because joined empty streams bypassed the existing exit-code fallback. Trim the bounded, redacted diagnostic before selecting that fallback. Source, command execution, error category, rollback and evidence contracts are unchanged.

Three controlled actual exit-7 processes per frozen arm: empty and whitespace streams now report the exact exit code, and meaningful parser text is retained (actionable diagnostics 1/3 to 3/3). All six failing operations leave source, package manifest, journal revision and validations unchanged. The two new regression cases fail on reference for the observed missing diagnosis; the modified four focused suites pass 249/249. Runtime/runner builds and changed-file ESLint pass. Compiled production change is deterministic-formatter.js only; the test artifact reflects two regression cases. Protocol, version IDs, all response details and compressed SHA-bound logs are preserved.

This is local error-presentation evidence, not model success or token savings. An initial package-manager fake preflight ran real Prettier rather than the intended failing binary; it was discarded before the reference comparison. The published controls directly resolve an isolated binary. F7 is absent from the frozen T6 model arms.
