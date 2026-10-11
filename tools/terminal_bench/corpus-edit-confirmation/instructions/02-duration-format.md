In src/duration.ts: Implement `formatDuration`: accept a nonnegative safe-integer number of milliseconds, discard fractional seconds, and return HH:MM:SS. Pad each component to at least two digits; hours can exceed 24 and must never wrap. Invalid, negative, noninteger or unsafe values throw RangeError. Preserve the export, signature and DURATION_LABEL value; do not add dependencies.

Modify only src/duration.ts. Work independently; do not retrieve published solutions or benchmark verifier source. Run the declared root build after the final edit and report its result.
