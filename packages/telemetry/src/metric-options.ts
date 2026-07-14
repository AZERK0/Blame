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
]);

export function metricInstrumentOptions(name: string): MetricOptions {
  const exact = exactOptions.get(name);
  if (exact) return exact;
  if (name.endsWith(".duration") || name.includes(".time_to_"))
    return { unit: "s" };
  if (name.endsWith(".count")) return { unit: "{event}" };
  return {};
}
