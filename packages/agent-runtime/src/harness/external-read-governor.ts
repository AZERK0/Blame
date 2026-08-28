import type {
  AgentTool,
  AgentToolContext,
  CoreSessionConfig,
} from "@cline/sdk";
import { sha256 } from "./protocol.js";
import type { HarnessCostGovernor } from "./cost-governor.js";

export type ExternalReadToolName =
  | "consult_specialist"
  | "fetch_web_content"
  | "get_preview_container_logs"
  | "get_preview_devtools";

type CachedExternalRead = {
  input: unknown;
  normalized: string;
  receiptId: string;
  result: unknown;
};

type ExternalReadMetrics = {
  cacheHits: number;
  calls: number;
  returnedBytes: number;
  suppressed: number;
};

type ExternalReadDecision =
  | {
      action: "execute";
      normalized: string;
      receiptId: string;
      resourceReceiptIds: string[];
    }
  | { action: "return"; result: unknown };

const maximumExternalResultBytes = 16_000;
type AgentHooks = NonNullable<CoreSessionConfig["hooks"]>;
type AfterToolContext = Parameters<NonNullable<AgentHooks["afterTool"]>>[0];
type BeforeToolContext = Parameters<NonNullable<AgentHooks["beforeTool"]>>[0];

export class ExternalReadGovernor {
  private dependencyMutationUnavailable = false;
  private readonly progressGovernor?: HarnessCostGovernor;
  private readonly cache = new Map<string, CachedExternalRead>();
  private readonly history: CachedExternalRead[] = [];
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly metrics: ExternalReadMetrics = {
    cacheHits: 0,
    calls: 0,
    returnedBytes: 0,
    suppressed: 0,
  };

  constructor(progressGovernor?: HarnessCostGovernor) {
    this.progressGovernor = progressGovernor;
  }

  wrap(tool: AgentTool): AgentTool {
    const toolName = tool.name;
    if (!isExternalReadTool(toolName)) return this.observeCapabilityTool(tool);
    return {
      ...tool,
      execute: async (input: unknown, context: AgentToolContext) => {
        const progressReceipt = this.progressGovernor?.beforeExternal(
          context.iteration,
        );
        if (progressReceipt) return progressReceipt;
        const decision = this.before(toolName, input, context);
        if (decision.action === "return") return decision.result;
        const pending = this.inFlight.get(decision.receiptId);
        if (pending) return this.afterInFlight(pending, decision.receiptId);
        const execution = Promise.resolve(tool.execute(input, context)).then(
          (result: unknown) => this.after(toolName, input, decision, result),
        );
        this.inFlight.set(decision.receiptId, execution);
        try {
          return await execution;
        } finally {
          this.inFlight.delete(decision.receiptId);
        }
      },
    };
  }

  fetchHooks(): NonNullable<CoreSessionConfig["hooks"]> {
    return {
      beforeTool: ({ tool, input, snapshot }: BeforeToolContext) => {
        if (tool.name !== "fetch_web_content") return undefined;
        const progressReceipt = this.progressGovernor?.beforeExternal(
          numberValue(snapshot.iteration),
        );
        if (progressReceipt)
          return { skip: true, reason: JSON.stringify(progressReceipt) };
        const decision = this.before("fetch_web_content", input);
        if (decision.action === "execute") return undefined;
        return { skip: true, reason: JSON.stringify(decision.result) };
      },
      afterTool: ({ tool, input, result }: AfterToolContext) => {
        if (tool.name !== "fetch_web_content") return undefined;
        const decision = this.pendingDecision(input);
        return {
          result: this.after(
            "fetch_web_content",
            input,
            decision,
            result,
          ) as typeof result,
        };
      },
    };
  }

  private before(
    tool: ExternalReadToolName,
    input: unknown,
    context?: AgentToolContext,
  ): ExternalReadDecision {
    this.metrics.calls += 1;
    const resources = normalizedExternalResources(tool, input, context);
    const normalized = resources.join("|");
    const receiptId = `external-read://${sha256(`${tool}\0${normalized}`)}`;
    if (
      this.dependencyMutationUnavailable &&
      dependencyMutationExploration(tool, normalized)
    )
      return this.dependencyUnavailableReceipt(receiptId);
    const resourceReceiptIds = resources.map(
      (resource) => `external-read://${sha256(`${tool}\0${resource}`)}`,
    );
    const cached = this.cache.get(receiptId);
    if (cached) return this.cachedReceipt(cached);
    const cachedResources = resourceReceiptIds
      .map((resourceReceiptId) => this.cache.get(resourceReceiptId))
      .filter((entry): entry is CachedExternalRead => Boolean(entry));
    if (
      resourceReceiptIds.length > 0 &&
      cachedResources.length === resourceReceiptIds.length
    )
      return this.cachedReceipt(cachedResources.at(-1)!);
    return { action: "execute", normalized, receiptId, resourceReceiptIds };
  }

  private observeCapabilityTool(tool: AgentTool): AgentTool {
    if (!capabilityReportingTool(tool.name)) return tool;
    return {
      ...tool,
      execute: async (input: unknown, context: AgentToolContext) => {
        const result = await tool.execute(input, context);
        if (containsUnavailableDependencyMutation(result))
          this.dependencyMutationUnavailable = true;
        return result;
      },
    };
  }

  private dependencyUnavailableReceipt(
    receiptId: string,
  ): Extract<ExternalReadDecision, { action: "return" }> {
    this.metrics.suppressed += 1;
    return {
      action: "return",
      result: {
        outcome: "unavailable",
        fatal: false,
        isError: false,
        status: "unavailable",
        applied: false,
        reason: "DEPENDENCY_MUTATION_UNAVAILABLE",
        retryable: false,
        receiptId,
        alternatives: [
          "reuse_existing_dependency",
          "implement_without_dependency",
          "report_blocked",
        ],
        recommendation:
          "Reuse an installed dependency, implement without it, or report the blocker.",
      },
    };
  }

  private pendingDecision(
    input: unknown,
  ): Extract<ExternalReadDecision, { action: "execute" }> {
    const resources = normalizedExternalResources("fetch_web_content", input);
    const normalized = resources.join("|");
    return {
      action: "execute",
      normalized,
      receiptId: `external-read://${sha256(`fetch_web_content\0${normalized}`)}`,
      resourceReceiptIds: resources.map(
        (resource) =>
          `external-read://${sha256(`fetch_web_content\0${resource}`)}`,
      ),
    };
  }

  private after(
    tool: ExternalReadToolName,
    input: unknown,
    decision: Extract<ExternalReadDecision, { action: "execute" }>,
    result: unknown,
  ) {
    const governed = this.governedResult(tool, decision.receiptId, result);
    const entry = {
      input,
      normalized: decision.normalized,
      receiptId: decision.receiptId,
      result: governed,
    };
    this.cache.set(entry.receiptId, entry);
    for (const resourceReceiptId of decision.resourceReceiptIds)
      this.cache.set(resourceReceiptId, {
        ...entry,
        receiptId: resourceReceiptId,
      });
    this.history.push(entry);
    if (this.history.length > 100) {
      const evicted = this.history.shift();
      if (evicted) this.cache.delete(evicted.receiptId);
    }
    while (this.cache.size > 300)
      this.cache.delete(this.cache.keys().next().value!);
    this.metrics.returnedBytes += serializedBytes(governed);
    return governed;
  }

  private governedResult(
    tool: ExternalReadToolName,
    receiptId: string,
    result: unknown,
  ) {
    if (!isAgentToolResult(result))
      return boundedResult(
        boundedExternalResult(result, tool),
        receiptId,
        tool,
      );
    const enriched = boundedResult(result, receiptId, tool);
    return boundedExternalResult(enriched, tool);
  }

  private cachedReceipt(
    entry: CachedExternalRead,
  ): Extract<ExternalReadDecision, { action: "return" }> {
    this.metrics.cacheHits += 1;
    this.metrics.suppressed += 1;
    return {
      action: "return",
      result: {
        outcome: "skipped",
        fatal: false,
        isError: false,
        status: "already_available",
        alreadyAvailable: true,
        receiptId: entry.receiptId,
        previous_receipt: entry.receiptId,
        reason: "REPEATED_EXTERNAL_READ",
        cached_summary: cachedSummary(entry.result),
        recommendation: "Continue with the next useful action.",
        sourceUnchanged: true,
      },
    };
  }

  private async afterInFlight(pending: Promise<unknown>, receiptId: string) {
    await pending;
    const cached = this.cache.get(receiptId);
    if (!cached)
      return {
        outcome: "failed",
        fatal: false,
        isError: false,
        reason: "EXTERNAL_READ_RECEIPT_UNAVAILABLE",
        recommendation: "Continue without the missing cached receipt.",
      };
    return this.cachedReceipt(cached).result;
  }
}

function normalizedExternalResources(
  tool: ExternalReadToolName,
  input: unknown,
  context?: AgentToolContext,
) {
  const value = recordValue(input);
  const requests = Array.isArray(value.requests)
    ? value.requests.map(normalizedFetchRequest)
    : [];
  const url = normalizedUrl(value.url);
  const query = normalizedText(
    String(value.prompt ?? value.query ?? value.task ?? value.context ?? ""),
  );
  const scope = [value.specialist, value.service, value.tailLines]
    .filter((item) => item !== undefined)
    .map((item) => normalizedText(String(item)))
    .join(":");
  const revision = normalizedText(
    String(
      context?.metadata?.sourceRevisionId ??
        context?.metadata?.source_revision_id ??
        "",
    ),
  );
  if (requests.length)
    return requests.map(
      (request) => `${tool}:${request}:${scope}:${query}:${revision}`,
    );
  return [`${tool}:${url}:${scope}:${query}:${revision}`];
}

function normalizedFetchRequest(value: unknown) {
  const request = recordValue(value);
  return `${normalizedUrl(request.url)}:${normalizedText(String(request.prompt ?? ""))}`;
}

function normalizedUrl(value: unknown) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    url.hash = "";
    url.pathname = url.pathname.replace(/\.md\/?$/iu, "");
    for (const key of [...url.searchParams.keys()])
      if (trackingParameter(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.toString();
  } catch {
    return normalizedText(value);
  }
}

function trackingParameter(value: string) {
  return /^(?:fbclid|gclid|mc_cid|mc_eid|ref|source|utm_.+)$/iu.test(value);
}

function normalizedText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

function boundedExternalResult(result: unknown, tool: ExternalReadToolName) {
  if (isAgentToolResult(result))
    return boundedAgentToolResult(normalizedAgentToolResult(result, tool));
  if (serializedBytes(result) <= maximumExternalResultBytes) return result;
  const serialized = JSON.stringify(result) ?? String(result);
  return {
    status: "bounded",
    truncated: true,
    excerpt: boundedUtf8(serialized, maximumExternalResultBytes - 256),
  };
}

function normalizedAgentToolResult(
  result: AgentToolResultEnvelope,
  tool: ExternalReadToolName,
): AgentToolResultEnvelope {
  const output =
    tool === "fetch_web_content"
      ? normalizedFetchOutput(result.output)
      : result.output;
  return {
    ...result,
    outcome: result.isError ? "failed" : "completed",
    fatal: result.fatal === true,
    reason: result.isError ? "EXTERNAL_READ_FAILED" : "EXTERNAL_READ_COMPLETED",
    recommendation: result.isError
      ? "Use the returned limitation and continue when possible."
      : "Continue with the task.",
    output,
    isError: result.fatal === true,
    metadata: { ...result.metadata },
  };
}

function normalizedFetchOutput(output: unknown) {
  if (Array.isArray(output)) return output;
  return output === undefined ? [] : [output];
}

function boundedAgentToolResult(result: AgentToolResultEnvelope) {
  if (serializedBytes(result) <= maximumExternalResultBytes) return result;
  const marked = {
    ...result,
    metadata: { ...result.metadata, externalReadTruncated: true },
  };
  return outputWithinBudget(marked);
}

function outputWithinBudget(result: AgentToolResultEnvelope) {
  let lowerBound = 0;
  let upperBound = maximumExternalResultBytes;
  let bounded = withBoundedOutput(result, 0);
  while (lowerBound <= upperBound) {
    const candidateLimit = Math.floor((lowerBound + upperBound) / 2);
    const candidate = withBoundedOutput(result, candidateLimit);
    if (serializedBytes(candidate) <= maximumExternalResultBytes) {
      bounded = candidate;
      lowerBound = candidateLimit + 1;
    } else upperBound = candidateLimit - 1;
  }
  return bounded;
}

function withBoundedOutput(
  result: AgentToolResultEnvelope,
  maximumTextBytes: number,
): AgentToolResultEnvelope {
  const output = Array.isArray(result.output)
    ? result.output.map((item) => boundedTextContent(item, maximumTextBytes))
    : boundedTextContent(result.output, maximumTextBytes);
  return { ...result, output };
}

function boundedTextContent(value: unknown, maximumTextBytes: number): unknown {
  if (typeof value === "string") return boundedUtf8(value, maximumTextBytes);
  if (Array.isArray(value))
    return value.map((item) => boundedTextContent(item, maximumTextBytes));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      boundedTextContent(item, maximumTextBytes),
    ]),
  );
}

function boundedUtf8(value: string, maximumBytes: number) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maximumBytes) return value;
  let excerpt = bytes.subarray(0, maximumBytes).toString("utf8");
  while (Buffer.byteLength(excerpt, "utf8") > maximumBytes)
    excerpt = excerpt.slice(0, -1);
  return excerpt.replace(/\uFFFD$/u, "");
}

function boundedResult(
  result: unknown,
  receiptId: string,
  tool: ExternalReadToolName,
) {
  if (isAgentToolResult(result))
    return {
      ...result,
      metadata: {
        ...result.metadata,
        externalReadReceiptId: receiptId,
      },
    };
  if (result && typeof result === "object" && !Array.isArray(result))
    return {
      outcome: "completed",
      fatal: false,
      reason: "EXTERNAL_READ_COMPLETED",
      recommendation: "Continue with the task.",
      ...result,
      externalReadReceiptId: receiptId,
      tool,
    };
  return {
    outcome: "completed",
    fatal: false,
    reason: "EXTERNAL_READ_COMPLETED",
    recommendation: "Continue with the task.",
    content: result,
    externalReadReceiptId: receiptId,
    tool,
  };
}

type AgentToolResultEnvelope = {
  fatal?: boolean;
  isError?: boolean;
  metadata?: Record<string, unknown>;
  outcome?: string;
  reason?: string;
  recommendation?: string;
  output: unknown;
};

function isAgentToolResult(value: unknown): value is AgentToolResultEnvelope {
  return Boolean(value && typeof value === "object" && "output" in value);
}

function isExternalReadTool(name: string): name is ExternalReadToolName {
  return [
    "consult_specialist",
    "fetch_web_content",
    "get_preview_container_logs",
    "get_preview_devtools",
  ].includes(name);
}

function capabilityReportingTool(name: string) {
  return ["mutate_dependencies", "run_task", "workspace_state"].includes(name);
}

function cachedSummary(value: unknown) {
  const serialized = JSON.stringify(value) ?? String(value);
  return boundedUtf8(serialized, 320);
}

function containsUnavailableDependencyMutation(
  value: unknown,
  depth = 0,
): boolean {
  if (depth > 8) return false;
  if (Array.isArray(value))
    return value.some((item) =>
      containsUnavailableDependencyMutation(item, depth + 1),
    );
  const record = recordValue(value);
  if (!Object.keys(record).length) return false;
  if (
    record.capability === "dependency_mutation" &&
    record.status === "unavailable"
  )
    return true;
  if (
    record.outcome === "unavailable" &&
    /^DEPENDENCY_(?:EXECUTOR|MUTATION)_UNAVAILABLE/iu.test(
      String(record.reason ?? ""),
    )
  )
    return true;
  return Object.values(record).some((item) =>
    containsUnavailableDependencyMutation(item, depth + 1),
  );
}

function dependencyMutationExploration(
  tool: ExternalReadToolName,
  normalized: string,
) {
  if (!["consult_specialist", "fetch_web_content"].includes(tool)) return false;
  return /\b(?:add (?:a )?dependency|ajouter (?:une )?d[ée]pendance|corepack|install(?:ation|ing)?|installer|lockfile update|mutat(?:e|ing) dependenc(?:y|ies)|(?:bun|npm|pnpm|yarn) add)\b/iu.test(
    normalized,
  );
}

function serializedBytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value) ?? String(value), "utf8");
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
