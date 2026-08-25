import type { MetricOptions } from "@opentelemetry/api";
import {
  genAiDurationBucketBoundaries,
  genAiTokenBucketBoundaries,
} from "./gen-ai.js";
import {
  METRIC_GEN_AI_OPERATION_DURATION,
  METRIC_GEN_AI_TIME_TO_FIRST_CHUNK,
  METRIC_GEN_AI_TOKEN_USAGE,
} from "./semantic-attributes.js";

export const runtimeDurationBucketBoundaries = [
  0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600, 900, 1_200, 1_800,
  2_400,
];

export const runtimeProbeDurationBucketBoundaries = [
  0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60,
];

export const runtimeReadinessPollBucketBoundaries = [
  0, 1, 2, 5, 10, 20, 30, 60, 90,
];

const exactOptions = new Map<string, MetricOptions>([
  [
    METRIC_GEN_AI_OPERATION_DURATION,
    {
      advice: { explicitBucketBoundaries: genAiDurationBucketBoundaries },
      description: "GenAI operation duration",
      unit: "s",
    },
  ],
  [
    METRIC_GEN_AI_TIME_TO_FIRST_CHUNK,
    {
      advice: { explicitBucketBoundaries: genAiDurationBucketBoundaries },
      description: "Time to the first GenAI response chunk",
      unit: "s",
    },
  ],
  [
    METRIC_GEN_AI_TOKEN_USAGE,
    {
      advice: { explicitBucketBoundaries: genAiTokenBucketBoundaries },
      description: "GenAI token usage",
      unit: "{token}",
    },
  ],
  ["blame.execution.count", { unit: "{execution}" }],
  ["blame.model.request.count", { unit: "{request}" }],
  ["blame.tool.call.count", { unit: "{call}" }],
  ["blame.tool.failure.count", { unit: "{failure}" }],
  ["blame.test.run.count", { unit: "{run}" }],
  ["blame.provider.error.count", { unit: "{error}" }],
  ["blame.gen_ai.estimated_cost", { unit: "{USD}" }],
  ["blame.gen_ai.cache_read_token.usage", { unit: "{token}" }],
  ["blame.gen_ai.cache_creation_token.usage", { unit: "{token}" }],
  ["blame.agent.files_modified", { unit: "{file}" }],
  ["blame.agent.tests_added", { unit: "{test}" }],
  ["blame.agent.iterations_per_execution", { unit: "{iteration}" }],
  ["blame.agent.tool_calls_per_execution", { unit: "{call}" }],
  ["blame.agent.retry.count", { unit: "{retry}" }],
  ["blame.agent.retries_per_execution", { unit: "{retry}" }],
  ["blame.harness.model_turns", { unit: "{turn}" }],
  ["blame.harness.context_tokens_per_turn", { unit: "{token}" }],
  ["blame.harness.time_to_first_edit", { unit: "s" }],
  ["blame.harness.reads", { unit: "{read}" }],
  ["blame.harness.read_bytes", { unit: "By" }],
  ["blame.harness.read_requested_bytes", { unit: "By" }],
  ["blame.harness.read_returned_bytes", { unit: "By" }],
  ["blame.harness.read_suppressed_bytes", { unit: "By" }],
  ["blame.harness.new_read_bytes", { unit: "By" }],
  ["blame.harness.read_overlap_rate", { unit: "1" }],
  ["blame.harness.deduplicated_reads", { unit: "{read}" }],
  ["blame.harness.duplicate_read_count", { unit: "{read}" }],
  ["blame.harness.external_reads", { unit: "{read}" }],
  ["blame.harness.external_read_cache_hits", { unit: "{read}" }],
  ["blame.harness.external_read_suppressed", { unit: "{read}" }],
  ["blame.harness.external_read_returned_bytes", { unit: "By" }],
  ["blame.harness.semantic_read_rebases", { unit: "{rebase}" }],
  ["blame.harness.direct_edits", { unit: "{edit}" }],
  ["blame.harness.automatically_rebased_edits", { unit: "{edit}" }],
  ["blame.harness.edit_conflicts", { unit: "{conflict}" }],
  ["blame.harness.edit_conflict_count", { unit: "{conflict}" }],
  ["blame.harness.internal_retries", { unit: "{retry}" }],
  ["blame.harness.tool_retry_count", { unit: "{retry}" }],
  ["blame.harness.capsule_input_tokens", { unit: "{token}" }],
  ["blame.harness.capsule_output_tokens", { unit: "{token}" }],
  ["blame.harness.capsule_requested_tokens", { unit: "{token}" }],
  ["blame.harness.capsule_actual_tokens", { unit: "{token}" }],
  ["blame.harness.capsule_truncated", { unit: "1" }],
  ["blame.harness.preserved_constraints", { unit: "{constraint}" }],
  ["blame.harness.continuity_update_present", { unit: "1" }],
  ["blame.harness.continuity_update_valid", { unit: "1" }],
  ["blame.harness.continuity_fallback_used", { unit: "1" }],
  ["blame.harness.facts_added_count", { unit: "{fact}" }],
  ["blame.harness.facts_superseded_count", { unit: "{fact}" }],
  ["blame.harness.invalid_evidence_ref_count", { unit: "{reference}" }],
  ["blame.harness.memory_merge_conflict_count", { unit: "{conflict}" }],
  ["blame.harness.recall_strategy", { unit: "1" }],
  ["blame.harness.recall_candidate_count", { unit: "{candidate}" }],
  ["blame.harness.recall_returned_count", { unit: "{item}" }],
  ["blame.harness.embedding_request_count", { unit: "{request}" }],
  ["blame.harness.embedding_cache_hit_count", { unit: "{hit}" }],
  ["blame.harness.embedding_cost", { unit: "{currency}" }],
  ["blame.harness.embedding_latency", { unit: "s" }],
  ["blame.harness.embedding_fallback_count", { unit: "{fallback}" }],
  ["blame.harness.context_size_before_compaction", { unit: "{token}" }],
  ["blame.harness.context_size_after_compaction", { unit: "{token}" }],
  ["blame.harness.model_retries", { unit: "{retry}" }],
  ["blame.harness.specialist_duration", { unit: "s" }],
  ["blame.harness.run_task_duration", { unit: "s" }],
  ["blame.harness.missing_run_artifacts", { unit: "{artifact}" }],
  ["blame.harness.preview_recoveries", { unit: "{recovery}" }],
  ["blame.harness.preview_recoveries_by_failure", { unit: "{recovery}" }],
  ["blame.harness.time_to_verifiable_result", { unit: "s" }],
  ["blame.runtime.operation.count", { unit: "{operation}" }],
  [
    "blame.runtime.operation.duration",
    {
      advice: { explicitBucketBoundaries: runtimeDurationBucketBoundaries },
      unit: "s",
    },
  ],
  ["blame.runtime.phase.count", { unit: "{phase}" }],
  [
    "blame.runtime.phase.duration",
    {
      advice: { explicitBucketBoundaries: runtimeDurationBucketBoundaries },
      unit: "s",
    },
  ],
  ["blame.runtime.probe.count", { unit: "{probe}" }],
  [
    "blame.runtime.probe.duration",
    {
      advice: {
        explicitBucketBoundaries: runtimeProbeDurationBucketBoundaries,
      },
      unit: "s",
    },
  ],
  [
    "blame.runtime.readiness.polls",
    {
      advice: {
        explicitBucketBoundaries: runtimeReadinessPollBucketBoundaries,
      },
      unit: "{poll}",
    },
  ],
  ["blame.runtime.dependency.issue.count", { unit: "{issue}" }],
]);

export function metricInstrumentOptions(name: string): MetricOptions {
  const exact = exactOptions.get(name);
  if (exact) return exact;
  if (name.endsWith(".duration") || name.includes(".time_to_"))
    return { unit: "s" };
  if (name.endsWith(".count")) return { unit: "{event}" };
  return {};
}
