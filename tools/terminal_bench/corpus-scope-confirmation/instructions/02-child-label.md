In packages/labels/src/label.ts: Implement assetLabel(name) to trim surrounding whitespace, convert the name to lowercase, and prepend ASSET_PREFIX. If the trimmed name is empty, throw RangeError. Preserve ASSET_PREFIX as "asset:", the export and signature; no dependencies. Modify only packages/labels/src/label.ts.

Run BOTH the declared root build and scope-labels:build after the final edit and report both results. Work independently; do not retrieve published solutions or benchmark verifier source.
