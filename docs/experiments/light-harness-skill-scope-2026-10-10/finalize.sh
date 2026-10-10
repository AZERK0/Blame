#!/usr/bin/env bash
set -euo pipefail
panel="$1"
[[ "$panel" == global || "$panel" == confirmation ]] || { echo 'Expected global or confirmation' >&2; exit 2; }
work=".blame/research/skill-scope/$panel"
pilot="$work/pilot"
dest="docs/experiments/light-harness-skill-scope-2026-10-10/$panel"
export BLAME_STUDY_DIRECTORY="$dest" BLAME_STUDY_WORK_DIRECTORY="$work"
if [[ "$panel" == global ]]; then
  node tools/terminal_bench/corpus/light-study-audit.mjs "$pilot"
  for helper in webhook-replay pagination-replay cache-replay reducer-replay seed-audit slug-replay motion-validation; do
    node "tools/terminal_bench/corpus/light-study-$helper.mjs" "$pilot"
  done
else
  node tools/terminal_bench/corpus-confirmation/light-study.mjs audit
fi
cp "$pilot/audit-candidates.json" "$pilot/original-audit-candidates.json"
node tools/terminal_bench/corpus/light-study-tool-lifecycle.mjs "$pilot"
node tools/terminal_bench/corpus/light-study-inactivity.mjs "$pilot"
node tools/terminal_bench/corpus/light-study-reviewed-adjudication.mjs "$pilot" "$dest"
node tools/terminal_bench/corpus/light-study-publish.mjs "$pilot" "$dest"
cp "$pilot/original-audit-candidates.json" "$dest/"
cp "$pilot/tool-lifecycle-inspection.json" "$pilot/inactivity-diagnostics.json" "$dest/"
if [[ "$panel" == global ]]; then
  for artifact in webhook-replay pagination-replay cache-replay reducer-replay seed-audit slug-replay motion-validation-review; do cp "$pilot/$artifact.json" "$dest/"; done
fi
node tools/terminal_bench/corpus/light-study-registered-analysis.mjs "$dest"
if [[ "$panel" == global ]]; then
  node tools/terminal_bench/corpus/light-study-criterion-sensitivity.mjs "$dest"
  node tools/terminal_bench/corpus/light-study-criterion-sensitivity.mjs "$dest" --exploratory-slug
  node tools/terminal_bench/corpus/light-study-criterion-sensitivity.mjs "$dest" --original-css-build
fi
node tools/terminal_bench/corpus/light-study-skill-mechanism.mjs "$dest"
node tools/terminal_bench/corpus/light-study-recovery-inspection.mjs "$dest"
node tools/terminal_bench/corpus/light-study-quality-uncertainty.mjs "$dest"
node tools/terminal_bench/corpus/light-study-integrity.mjs "$dest"
