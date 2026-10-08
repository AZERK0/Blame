import { auditSdkUsage } from "../../../packages/agent-runtime/dist/usage-audit.js";

export function requestUsage(fields = {}) {
  // Event total* fields are cumulative. Absent per-request fields remain absent.
  return auditSdkUsage(
    Object.fromEntries(
      [
        "inputTokens",
        "outputTokens",
        "cacheReadTokens",
        "cacheWriteTokens",
        "reasoningTokens",
        "cost",
      ]
        .filter((key) => fields[key] !== undefined)
        .map((key) => [key, fields[key]]),
    ),
  );
}

export function reconcileUsage(aggregate, events, requests) {
  const usage = auditSdkUsage(aggregate),
    perRequest = events.map(requestUsage);
  const reconciliation = {};
  for (const field of ["input", "output", "cacheRead", "cacheWrite", "cost"]) {
    const sum =
      perRequest.length && perRequest.every((u) => u[field] !== null)
        ? perRequest.reduce((s, u) => s + u[field], 0)
        : null;
    reconciliation[field] = {
      sum,
      aggregate: usage[field],
      matches:
        sum !== null &&
        usage[field] !== null &&
        Math.abs(sum - usage[field]) <= Math.max(1e-9, Math.abs(sum) * 1e-8),
    };
  }
  const allRequests = requests > 0 && requests === perRequest.length;
  return {
    ...usage,
    complete:
      allRequests && Object.values(reconciliation).every((x) => x.matches),
    tokensCostReconciled:
      allRequests &&
      ["input", "output", "cost"].every((f) => reconciliation[f].matches),
    requests,
    reports: perRequest.length,
    perRequest,
    reconciliation,
  };
}
