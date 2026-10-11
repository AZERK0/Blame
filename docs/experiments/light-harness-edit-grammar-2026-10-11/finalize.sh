#!/usr/bin/env bash
set -euo pipefail
panel="$1"
[[ "$panel" == global || "$panel" == canary || "$panel" == confirmation ]] || { echo 'Expected global, canary or confirmation' >&2; exit 2; }
work=".blame/research/edit-grammar/$panel"
pilot="$work/pilot"
dest="docs/experiments/light-harness-edit-grammar-2026-10-11/$panel"
export BLAME_STUDY_DIRECTORY="$dest" BLAME_STUDY_WORK_DIRECTORY="$work"
if [[ "$panel" == confirmation ]]; then
  node tools/terminal_bench/corpus-edit-confirmation/light-study.mjs audit
else
  node tools/terminal_bench/corpus/light-study-audit.mjs "$pilot"
fi
for helper in webhook-replay pagination-replay cache-replay reducer-replay seed-audit slug-replay motion-validation; do
  node "tools/terminal_bench/corpus/light-study-$helper.mjs" "$pilot"
done
if [[ "$panel" == global ]]; then
  node tools/terminal_bench/corpus/light-study-storage-percent-replay.mjs "$pilot"
  node tools/terminal_bench/corpus/light-study-seed-source-proof.mjs "$pilot"
fi
cp "$pilot/audit-candidates.json" "$pilot/original-audit-candidates.json"
node tools/terminal_bench/corpus/light-study-tool-lifecycle.mjs "$pilot"
node tools/terminal_bench/corpus/light-study-inactivity.mjs "$pilot"
node tools/terminal_bench/corpus/light-study-reviewed-adjudication.mjs "$pilot" "$dest"
node tools/terminal_bench/corpus/light-study-publish.mjs "$pilot" "$dest"
cp "$pilot/original-audit-candidates.json" "$dest/"
cp "$pilot/tool-lifecycle-inspection.json" "$pilot/inactivity-diagnostics.json" "$dest/"
if [[ "$panel" == global ]]; then
  cp "$pilot/storage-percent-replay.json" "$dest/"
  cp "$pilot/seed-source-proof.json" "$dest/"
fi
if [[ "$panel" == global || "$panel" == canary ]]; then
  for artifact in webhook-replay pagination-replay cache-replay reducer-replay seed-audit slug-replay motion-validation-review; do cp "$pilot/$artifact.json" "$dest/"; done
fi
if [[ "$panel" == global ]]; then
  node tools/terminal_bench/corpus/light-study-storage-percent-sensitivity.mjs "$dest"
fi
node tools/terminal_bench/corpus/light-study-registered-analysis.mjs "$dest"
if [[ "$panel" == global || "$panel" == canary ]]; then
  node tools/terminal_bench/corpus/light-study-criterion-sensitivity.mjs "$dest"
  node tools/terminal_bench/corpus/light-study-criterion-sensitivity.mjs "$dest" --exploratory-slug
  node tools/terminal_bench/corpus/light-study-criterion-sensitivity.mjs "$dest" --original-css-build
fi
node tools/terminal_bench/corpus/light-study-skill-mechanism.mjs "$dest"
node tools/terminal_bench/corpus/light-study-recovery-inspection.mjs "$pilot"
cp "$pilot/recovery-inspection.json" "$dest/"
node tools/terminal_bench/corpus/light-study-quality-uncertainty.mjs "$dest"
node tools/terminal_bench/corpus/light-study-integrity.mjs "$dest"
node tools/terminal_bench/corpus/light-study-edit-mechanism.mjs "$dest"
if [[ "$panel" != confirmation ]]; then
  node tools/terminal_bench/corpus/light-study-register-known-diagnostics.mjs "$dest"
fi
