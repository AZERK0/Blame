#!/usr/bin/env bash
# Publish only a complete panel with every raw trace manually reviewed.
set -euo pipefail
panel="${1:?canary, global or confirmation}"
case "$panel" in canary|global|confirmation) ;; *) exit 2 ;; esac
work=".blame/research/task-scopes/$panel"
pilot="$work/pilot"
dest="docs/experiments/light-harness-task-scopes-2026-10-11/$panel"
export BLAME_STUDY_DIRECTORY="$dest" BLAME_STUDY_WORK_DIRECTORY="$work"
if [[ "$panel" == confirmation ]]; then
  node tools/terminal_bench/corpus-scope-confirmation/light-study.mjs audit
else
  node tools/terminal_bench/corpus/light-study-audit.mjs "$pilot"
  for helper in webhook-replay pagination-replay cache-replay reducer-replay seed-audit slug-replay motion-validation storage-percent-replay storage-percent-family-replay; do
    node "tools/terminal_bench/corpus/light-study-$helper.mjs" "$pilot"
  done
fi
cp "$pilot/audit-candidates.json" "$pilot/original-audit-candidates.json"
node tools/terminal_bench/corpus/light-study-tool-lifecycle.mjs "$pilot"
node tools/terminal_bench/corpus/light-study-inactivity.mjs "$pilot"
node tools/terminal_bench/corpus/light-study-reviewed-adjudication.mjs "$pilot" "$dest"
node tools/terminal_bench/corpus/light-study-semantic-endpoint.mjs "$pilot" "$dest"
node tools/terminal_bench/corpus/light-study-publish.mjs "$pilot" "$dest"
cp "$pilot/original-audit-candidates.json" "$pilot/base-adjudication.json" "$pilot/tool-lifecycle-inspection.json" "$pilot/inactivity-diagnostics.json" "$pilot/provenance.json" "$dest/"
if [[ "$panel" != confirmation ]]; then
  for artifact in webhook-replay pagination-replay cache-replay reducer-replay seed-audit slug-replay motion-validation-review storage-percent-replay storage-percent-family-replay; do cp "$pilot/$artifact.json" "$dest/"; done
fi
node tools/terminal_bench/corpus/light-study-registered-analysis.mjs "$dest"
if [[ "$panel" != confirmation ]]; then
  node tools/terminal_bench/corpus/light-study-criterion-sensitivity.mjs "$dest"
  node tools/terminal_bench/corpus/light-study-criterion-sensitivity.mjs "$dest" --original-css-build
  node tools/terminal_bench/corpus/light-study-percent-family-sensitivity.mjs "$dest"
fi
for helper in skill-mechanism edit-mechanism task-scope-mechanism recovery-inspection quality-uncertainty integrity; do
  node "tools/terminal_bench/corpus/light-study-$helper.mjs" "$dest"
done
