export type HarnessFeatureFlagDefinition = {
  owner: string;
  behavior: string;
  default_enabled: boolean;
  introduced_at: string;
  removal_criterion: string;
  deadline: string;
  tests: string[];
  metrics: string[];
};

export const harnessFeatureFlagRegistry = {
  BLAME_CLINE_MESSAGE_BUILDER_COMPACTION: definition(
    "cline-adapter",
    "Deterministic provider-bound compaction projection",
    true,
    "US-021 replay and the runtime compatibility matrix pass",
    [
      "compactions",
      "context_size_before_compaction",
      "context_size_after_compaction",
    ],
  ),
  BLAME_CONTEXT_EPOCHS: definition(
    "projection-engine",
    "Revision-bound context epochs",
    true,
    "Context projection conformance passes",
    ["context_epoch_changes"],
  ),
  BLAME_SEMANTIC_READ_REBASE: definition(
    "semantic-resolver",
    "Automatic semantic read rebase",
    true,
    "semantic-rebase/v1 replaces the legacy reader",
    ["read_rebases", "read_rebase_conflicts"],
  ),
  BLAME_WORKING_SET_V2: definition(
    "projection-engine",
    "Revision-bound read working set",
    true,
    "Working set v3 rehydration passes the release matrix",
    ["covered_reads", "rehydrated_reads"],
  ),
  BLAME_SEMANTIC_REBASE_V2: definition(
    "semantic-resolver",
    "Legacy semantic rebase path",
    true,
    "semantic-rebase/v1 has zero false writes on calibration",
    ["automatic_rebases", "incorrect_rebases"],
  ),
  BLAME_PATCH_RECOVERY_V2: definition(
    "transaction-engine",
    "Bounded patch recovery",
    true,
    "Canonical edit transaction corpus passes",
    ["patch_retries", "patch_conflicts"],
  ),
  BLAME_COST_GOVERNOR_V2: definition(
    "execution-authority",
    "Legacy deterministic cost governor",
    true,
    "Retry ledger and evidence planner replace all governed paths",
    ["suppressed_calls", "duplicate_io"],
  ),
  BLAME_MEMORY_AUTHORITY_V2: definition(
    "conversation-authority",
    "Persisted conversation memory authority",
    true,
    "Conversation Authority migration fixtures pass",
    ["continuity_updates", "continuity_fallbacks"],
  ),
  BLAME_HARD_CAPSULE_BUDGET: definition(
    "projection-engine",
    "Hard capsule output bound",
    true,
    "Projection Engine owns all capsule budgets",
    ["capsule_tokens", "capsule_truncations"],
  ),
  BLAME_SEMANTIC_RECALL: definition(
    "projection-engine",
    "Semantic continuity recall",
    true,
    "Recall projection is reconstructible from authorities",
    ["recall_hits", "recall_misses"],
  ),
  BLAME_OPENROUTER_EMBEDDINGS: definition(
    "projection-engine",
    "Remote embeddings for recall",
    false,
    "Remote recall demonstrates value under network policy",
    ["embedding_requests", "embedding_failures"],
  ),
  BLAME_NATIVE_CLINE_HARNESS: definition(
    "cline-adapter",
    "Native Cline harness tools and completion",
    true,
    "Cline and headless v3 conformance are equivalent",
    ["cline_tool_calls", "completion_decisions"],
  ),
  BLAME_HARNESS_PROTOCOL_V3: definition(
    "harness-core",
    "Canonical v3 result transport",
    true,
    "All consumers read v3 and historical v2 fixtures remain readable",
    ["v3_results", "v2_projection_divergences"],
  ),
} as const satisfies Record<string, HarnessFeatureFlagDefinition>;

export type HarnessFeatureFlag = keyof typeof harnessFeatureFlagRegistry;

export function harnessFeatureEnabled(
  name: HarnessFeatureFlag,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const value = environment[name]?.trim().toLowerCase();
  if (value === undefined)
    return harnessFeatureFlagRegistry[name].default_enabled;
  return !["0", "false", "off"].includes(value);
}

export function harnessFeatureDefinitions() {
  return Object.entries(harnessFeatureFlagRegistry).map(([name, value]) => ({
    name: name as HarnessFeatureFlag,
    ...value,
    tests: [...value.tests],
    metrics: [...value.metrics],
  }));
}

function definition(
  owner: string,
  behavior: string,
  defaultEnabled: boolean,
  removalCriterion: string,
  metrics: string[],
): HarnessFeatureFlagDefinition {
  return {
    owner,
    behavior,
    default_enabled: defaultEnabled,
    introduced_at: "2026-08-29",
    removal_criterion: removalCriterion,
    deadline: "2026-12-15",
    tests: ["harness-reliability", "adapter-conformance"],
    metrics,
  };
}
