In src/backoff.ts: Implement retryDelay(attempt, baseMs). attempt must be an integer from 0 through 10, and baseMs an integer from 0 through 1000000; otherwise throw RangeError. Return Math.min(5000, baseMs * 2 ** attempt). Preserve RETRY_LABEL, the export and signature. Modify only src/backoff.ts; no dependencies.

Run the declared root build after the final edit and report its result. The idle application is unrelated to this change. Work independently; do not retrieve published solutions or benchmark verifier source.
