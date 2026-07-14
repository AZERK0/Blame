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
