import {
  type AgentSessionTelemetry,
  asRecord,
  metricDimensions,
  numericValue,
  telemetry,
  type UsageSnapshot,
} from "./agent-telemetry-state.js";
import {
  ATTR_GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
  ATTR_GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
  ATTR_GEN_AI_USAGE_INPUT_TOKENS,
  ATTR_GEN_AI_USAGE_OUTPUT_TOKENS,
  type Context,
  METRIC_GEN_AI_TOKEN_USAGE,
} from "@blame/telemetry";

export function usageSnapshot(value: unknown): UsageSnapshot {
  const envelope = asRecord(value);
  const usage = usageRecord(envelope);
  return {
    cacheCreated: usageNumber(
      usage,
      "totalCacheWriteTokens",
      "cacheWriteTokens",
    ),
    cacheRead: usageNumber(usage, "totalCacheReadTokens", "cacheReadTokens"),
    cost: usageNumber(usage, "totalCost", "cost"),
    input: usageNumber(usage, "totalInputTokens", "inputTokens"),
    output: usageNumber(usage, "totalOutputTokens", "outputTokens"),
  };
}

export function usageDelta(previous: UsageSnapshot, next: UsageSnapshot) {
  return {
    cacheCreated: monotonicDelta(previous.cacheCreated, next.cacheCreated),
    cacheRead: monotonicDelta(previous.cacheRead, next.cacheRead),
    cost: monotonicDelta(previous.cost, next.cost),
    input: monotonicDelta(previous.input, next.input),
    output: monotonicDelta(previous.output, next.output),
  };
}

function usageRecord(envelope: Record<string, unknown>) {
  const aggregate = asRecord(envelope.aggregateUsage);
  if (Object.keys(aggregate).length) return aggregate;
  const usage = asRecord(envelope.usage);
  if (Object.keys(usage).length) return usage;
  const result = asRecord(envelope.result);
  const resultUsage = asRecord(result.usage);
  return Object.keys(resultUsage).length ? resultUsage : envelope;
}

function usageNumber(
  usage: Record<string, unknown>,
  totalKey: string,
  fallbackKey: string,
) {
  return numericValue(usage[totalKey]) ?? numericValue(usage[fallbackKey]) ?? 0;
}

function monotonicDelta(previous: number, next: number) {
  return next >= previous ? next - previous : next;
}

export function recordTokenUsage(
  state: AgentSessionTelemetry,
  delta: UsageSnapshot,
  activeContext: Context,
) {
  recordToken(state, "input", delta.input, activeContext);
  recordToken(state, "output", delta.output, activeContext);
  recordCacheUsage(state, delta, activeContext);
}

function recordCacheUsage(
  state: AgentSessionTelemetry,
  usage: UsageSnapshot,
  activeContext: Context,
) {
  recordCacheMetric(
    "blame.gen_ai.cache_read_token.usage",
    usage.cacheRead,
    state,
    activeContext,
  );
  recordCacheMetric(
    "blame.gen_ai.cache_creation_token.usage",
    usage.cacheCreated,
    state,
    activeContext,
  );
}

function recordCacheMetric(
  name: string,
  value: number,
  state: AgentSessionTelemetry,
  activeContext: Context,
) {
  if (value <= 0) return;
  telemetry.record(name, value, metricDimensions(state), activeContext);
}

export function recordCost(
  state: AgentSessionTelemetry,
  cost: number,
  activeContext: Context,
) {
  if (cost <= 0) return;
  telemetry.count(
    "blame.gen_ai.estimated_cost",
    cost,
    metricDimensions(state),
    activeContext,
  );
}

function recordToken(
  state: AgentSessionTelemetry,
  type: string,
  value: number,
  activeContext: Context,
) {
  if (value <= 0) return;
  telemetry.record(
    METRIC_GEN_AI_TOKEN_USAGE,
    value,
    { ...metricDimensions(state), "gen_ai.token.type": type },
    activeContext,
  );
}

export function usageAttributes(usage: UsageSnapshot) {
  return {
    [ATTR_GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS]: usage.cacheCreated,
    [ATTR_GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS]: usage.cacheRead,
    [ATTR_GEN_AI_USAGE_INPUT_TOKENS]: usage.input,
    [ATTR_GEN_AI_USAGE_OUTPUT_TOKENS]: usage.output,
  };
}

export function emptyUsage(): UsageSnapshot {
  return { cacheCreated: 0, cacheRead: 0, cost: 0, input: 0, output: 0 };
}

export function recordModelUsage(
  state: AgentSessionTelemetry,
  agentKey: string | undefined,
  delta: UsageSnapshot,
) {
  if (!agentKey) return;
  const current = state.modelSpans.get(agentKey);
  if (!current) return;
  current.usage = addUsage(current.usage, delta);
  current.span.setAttributes(usageAttributes(current.usage));
}

export function addUsage(current: UsageSnapshot, delta: UsageSnapshot) {
  return {
    cacheCreated: current.cacheCreated + delta.cacheCreated,
    cacheRead: current.cacheRead + delta.cacheRead,
    cost: current.cost + delta.cost,
    input: current.input + delta.input,
    output: current.output + delta.output,
  };
}

export function missingUsage(current: UsageSnapshot, candidate: UsageSnapshot) {
  return {
    cacheCreated: Math.max(0, candidate.cacheCreated - current.cacheCreated),
    cacheRead: Math.max(0, candidate.cacheRead - current.cacheRead),
    cost: Math.max(0, candidate.cost - current.cost),
    input: Math.max(0, candidate.input - current.input),
    output: Math.max(0, candidate.output - current.output),
  };
}
