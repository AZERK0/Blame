# Cline core image accounting

This pnpm patch applies only to `@cline/core@0.0.81`. Its optional `imageTokenLimit` replaces the base64 contribution in compaction estimates with a per-image token bound. It affects both the compaction trigger and retained-message selection. The default path is unchanged, including the native Cline benchmark control.

Blame enables the option only for documented GPT-5.6 image-capable provider/model combinations. Canonical messages and image pixels are unchanged. `packages/agent-runtime/src/image-compaction.test.ts` exercises the real SDK API, including session normalization, constrained budgets and the unchanged text/default paths. The helper is readable in the patch; most patch bytes come from the SDK's three minified distribution bundles.

All three bundles carry the same distinct hub build identity, preventing reuse of an older managed hub. Upgrading the SDK requires regenerating this patch against the pristine npm package and rerunning the SDK, local/remote session and standalone delivery checks. Do not edit pnpm's installed dependency directories by hand.

The estimator uses the conservative documented 36,000-token maximum per accepted image for the enabled models, not an exact pixel-aware count. Small images can still be overestimated. See the September 7 harness report for the offline reproductions and measured performance limits.
