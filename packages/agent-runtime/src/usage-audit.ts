export type UsageAudit = {
  completeness: "complete" | "partial" | "unavailable";
  input: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  output: number | null;
  reasoning: number | null;
  cost: number | null;
  normalizationVersion: "blame-usage-v1";
};

/** SDK aggregates are observations, not a provider pricing model. Missing is not zero. */
export function auditSdkUsage(value: unknown): UsageAudit {
  const envelope = record(value);
  const usage =
    envelope.aggregateUsage ??
    envelope.usage ??
    record(envelope.result).usage ??
    envelope;
  const fields = record(usage);
  const number = (...keys: string[]) => {
    for (const key of keys) {
      const value = fields[key];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0)
        return value;
    }
    return null;
  };
  const input = number("totalInputTokens", "inputTokens");
  const output = number("totalOutputTokens", "outputTokens");
  const cacheRead = number("totalCacheReadTokens", "cacheReadTokens");
  const cacheWrite = number("totalCacheWriteTokens", "cacheWriteTokens");
  const cost = number("totalCost", "cost");
  const values = [input, output, cacheRead, cacheWrite, cost];
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    cost,
    reasoning: number("totalReasoningTokens", "reasoningTokens"),
    completeness: values.every((value) => value !== null)
      ? "complete"
      : values.every((value) => value === null)
        ? "unavailable"
        : "partial",
    normalizationVersion: "blame-usage-v1",
  };
}

/** Explicit provider semantics are required before deriving disjoint billable buckets. */
export function disjointUsage(
  usage: UsageAudit,
  profile: {
    inputIncludesCacheRead: boolean;
    inputIncludesCacheWrite: boolean;
  },
) {
  if (
    usage.input === null ||
    usage.cacheRead === null ||
    usage.cacheWrite === null ||
    usage.output === null
  )
    return null;
  const ordinary =
    usage.input -
    (profile.inputIncludesCacheRead ? usage.cacheRead : 0) -
    (profile.inputIncludesCacheWrite ? usage.cacheWrite : 0);
  if (
    ordinary < 0 ||
    (usage.reasoning !== null && usage.reasoning > usage.output)
  )
    return null;
  // Reasoning is an output detail and is deliberately not added to output.
  return {
    ordinary,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    output: usage.output,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
