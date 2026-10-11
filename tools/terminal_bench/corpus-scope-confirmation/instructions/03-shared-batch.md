Change MAX_BATCH from 1 to 4 in packages/settings/src/settings.ts, preserving BATCH_LABEL as "Batch" and both exports. Modify only that file; keep the existing root splitIds consumer and other source unchanged. The root consumer must consequently group up to four IDs into fresh chunks, preserving order and input.

Run BOTH the declared root build and scope-settings:build after the final edit and report both results. The idle application is unrelated; do not repair it. Work independently; do not retrieve published solutions or benchmark verifier source.
