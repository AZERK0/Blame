import type {
  AgentTool,
  AgentToolContext,
  CoreSessionConfig,
} from "@cline/sdk";
import { sha256 } from "./protocol.js";

export type ExternalReadToolName =
  | "consult_specialist"
  | "fetch_web_content"
  | "get_preview_container_logs"
  | "get_preview_devtools";

type CachedExternalRead = {
  cachedAt: number;
  expiresAt: number;
  fullResult: unknown;
  receiptId: string;
  result: unknown;
  tool: ExternalReadToolName;
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
      receiptId: string;
      resourceReceiptIds: string[];
    }
  | { action: "return"; result: unknown };

const maximumExternalResultBytes = 8_000;
const externalReceiptChunkBytes = 6_000;
const externalResultContentBudgetBytes = 7_000;
type AgentHooks = NonNullable<CoreSessionConfig["hooks"]>;
type AfterToolContext = Parameters<NonNullable<AgentHooks["afterTool"]>>[0];
type BeforeToolContext = Parameters<NonNullable<AgentHooks["beforeTool"]>>[0];

export class ExternalReadGovernor {
  private readonly cache = new Map<string, CachedExternalRead>();
  private readonly failedFetches = new Map<string, CachedExternalRead>();
  private readonly history: CachedExternalRead[] = [];
  private readonly hookReceipts = new Map<string, unknown>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly metrics: ExternalReadMetrics = {
    cacheHits: 0,
    calls: 0,
    returnedBytes: 0,
    suppressed: 0,
  };

  newUserRequest() {
    this.hookReceipts.clear();
    for (const [key, entry] of this.cache)
      if (dynamicExternalRead(entry.tool)) this.cache.delete(key);
  }

  receiptTool(): AgentTool {
    return {
      name: "inspect_external_read",
      description:
        "Read a precise UTF-8 chunk from a truncated external-read receipt. Use the receipt_id and next_offset_bytes returned by the original tool; this never repeats the network request.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          receipt_id: { type: "string", minLength: 1 },
          offset_bytes: { type: "integer", minimum: 0 },
          max_bytes: {
            type: "integer",
            minimum: 256,
            maximum: maximumExternalResultBytes,
          },
        },
        required: ["receipt_id"],
      },
      retryable: false,
      maxRetries: 0,
      execute: async (input: unknown) => this.inspectReceipt(input),
    } as AgentTool;
  }
  wrap(tool: AgentTool): AgentTool {
    const toolName = tool.name;
    if (!isExternalReadTool(toolName)) return tool;
    return {
      ...tool,
      execute: async (input: unknown, context: AgentToolContext) => {
        const decision = this.before(toolName, input, context);
        if (decision.action === "return") return decision.result;
        const pending = this.inFlight.get(decision.receiptId);
        if (pending) return this.afterInFlight(pending, decision.receiptId);
        const execution = Promise.resolve(tool.execute(input, context)).then(
          (result: unknown) => this.after(toolName, decision, result),
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
      beforeTool: (context: BeforeToolContext) => {
        const { tool, input } = context;
        if (tool.name !== "fetch_web_content") return undefined;
        const decision = this.before("fetch_web_content", input);
        if (decision.action === "execute") return undefined;
        return this.skipHook(context, decision.result);
      },
      afterTool: (context: AfterToolContext) => {
        const { tool, input, result } = context;
        if (tool.name !== "fetch_web_content") return undefined;
        const skipped = this.hookReceipts.get(hookReceiptKey(context));
        if (skipped !== undefined) {
          this.hookReceipts.delete(hookReceiptKey(context));
          return {
            result: {
              output: skipped,
              isError: false,
              metadata: {
                ...result.metadata,
                governedExternalReadReceipt: true,
              },
            },
          };
        }
        const decision = this.pendingDecision(input);
        return {
          result: this.after(
            "fetch_web_content",
            decision,
            result,
          ) as typeof result,
        };
      },
    };
  }

  private skipHook(context: BeforeToolContext, receipt: unknown) {
    this.hookReceipts.set(hookReceiptKey(context), receipt);
    while (this.hookReceipts.size > 100)
      this.hookReceipts.delete(this.hookReceipts.keys().next().value!);
    return {
      skip: true,
      reason: receiptReason(receipt),
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
    const resourceReceiptIds = resources.map(
      (resource) => `external-read://${sha256(`${tool}\0${resource}`)}`,
    );
    const cached = this.reusableCachedEntry(tool, receiptId);
    if (cached) return this.cachedReceipt(cached);
    const failedFetch = this.reusableFailedFetch(tool, input);
    if (failedFetch) return this.cachedReceipt(failedFetch);
    const cachedResources = resourceReceiptIds
      .map((resourceReceiptId) =>
        this.reusableCachedEntry(tool, resourceReceiptId),
      )
      .filter((entry): entry is CachedExternalRead => Boolean(entry));
    if (
      resourceReceiptIds.length > 0 &&
      cachedResources.length === resourceReceiptIds.length
    )
      return this.cachedReceipt(cachedResources.at(-1)!);
    return { action: "execute", receiptId, resourceReceiptIds };
  }

  private pendingDecision(
    input: unknown,
  ): Extract<ExternalReadDecision, { action: "execute" }> {
    const resources = normalizedExternalResources("fetch_web_content", input);
    const normalized = resources.join("|");
    return {
      action: "execute",
      receiptId: `external-read://${sha256(`fetch_web_content\0${normalized}`)}`,
      resourceReceiptIds: resources.map(
        (resource) =>
          `external-read://${sha256(`fetch_web_content\0${resource}`)}`,
      ),
    };
  }

  private after(
    tool: ExternalReadToolName,
    decision: Extract<ExternalReadDecision, { action: "execute" }>,
    result: unknown,
  ) {
    const governed = this.governedResult(tool, decision.receiptId, result);
    const entry = {
      cachedAt: Date.now(),
      expiresAt: Date.now() + externalReadCacheTtl(tool, governed),
      fullResult: result,
      receiptId: decision.receiptId,
      result: governed,
      tool,
    };
    this.cache.set(entry.receiptId, entry);
    for (const resourceReceiptId of decision.resourceReceiptIds)
      this.cache.set(resourceReceiptId, {
        ...entry,
        receiptId: resourceReceiptId,
      });
    if (tool === "fetch_web_content") this.rememberFailedFetches(result, entry);
    this.history.push(entry);
    if (this.history.length > 100) {
      const evicted = this.history.shift();
      if (evicted) this.cache.delete(evicted.receiptId);
    }
    while (this.cache.size > 300)
      this.cache.delete(this.cache.keys().next().value!);
    while (this.failedFetches.size > 100)
      this.failedFetches.delete(this.failedFetches.keys().next().value!);
    this.metrics.returnedBytes += serializedBytes(governed);
    return governed;
  }

  private governedResult(
    tool: ExternalReadToolName,
    receiptId: string,
    result: unknown,
  ) {
    const enriched = boundedResult(result, receiptId, tool);
    const governed = boundedExternalResult(enriched, tool);
    return serializedBytes(enriched) > maximumExternalResultBytes
      ? withExternalContinuation(governed, receiptId, result)
      : governed;
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
        continuation_tool: "inspect_external_read",
        cache_age_ms: Date.now() - entry.cachedAt,
        recommendation:
          "Continue with the next useful action, or inspect this receipt when an omitted section is required.",
        sourceUnchanged: false,
      },
    };
  }

  private async afterInFlight(pending: Promise<unknown>, receiptId: string) {
    const result = await pending;
    const cached = this.cachedEntry(receiptId);
    if (!cached || dynamicExternalRead(cached.tool)) return result;
    return this.cachedReceipt(cached).result;
  }

  private reusableCachedEntry(tool: ExternalReadToolName, receiptId: string) {
    return dynamicExternalRead(tool) ? undefined : this.cachedEntry(receiptId);
  }

  private reusableFailedFetch(tool: ExternalReadToolName, input: unknown) {
    if (tool !== "fetch_web_content") return undefined;
    const urls = fetchRequestUrls(input);
    if (!urls.length) return undefined;
    const entries = urls
      .map((url) => this.failedFetchEntry(url))
      .filter((entry): entry is CachedExternalRead => Boolean(entry));
    return entries.length === urls.length ? entries.at(-1) : undefined;
  }

  private failedFetchEntry(url: string) {
    const entry = this.failedFetches.get(url);
    if (!entry || entry.expiresAt > Date.now()) return entry;
    this.failedFetches.delete(url);
    return undefined;
  }

  private rememberFailedFetches(result: unknown, entry: CachedExternalRead) {
    for (const url of failedFetchUrls(result))
      this.failedFetches.set(url, entry);
  }

  private cachedEntry(receiptId: string) {
    const entry = this.cache.get(receiptId);
    if (!entry || entry.expiresAt > Date.now()) return entry;
    this.cache.delete(receiptId);
    return undefined;
  }

  private inspectReceipt(input: unknown) {
    const value = recordValue(input);
    const receiptId = stringValue(value.receipt_id);
    if (!receiptId)
      return externalReceiptFailure("INVALID_EXTERNAL_READ_RECEIPT");
    const entry = this.cachedEntry(receiptId);
    if (!entry) return externalReceiptFailure("EXTERNAL_READ_RECEIPT_EXPIRED");
    const serialized =
      JSON.stringify(entry.fullResult) ?? String(entry.fullResult);
    const totalBytes = Buffer.byteLength(serialized, "utf8");
    const offset = boundedInteger(value.offset_bytes, 0, totalBytes, 0);
    const maximumBytes = boundedInteger(
      value.max_bytes,
      256,
      maximumExternalResultBytes,
      externalReceiptChunkBytes,
    );
    const excerpt = utf8Slice(serialized, offset, maximumBytes);
    const returnedBytes = Buffer.byteLength(excerpt, "utf8");
    const nextOffset = offset + returnedBytes;
    return {
      outcome: "completed",
      fatal: false,
      isError: false,
      reason: "EXTERNAL_READ_RECEIPT_INSPECTED",
      recommendation:
        nextOffset < totalBytes
          ? "Continue from next_offset_bytes only if the missing section is required."
          : "Continue with the task.",
      receipt_id: receiptId,
      offset_bytes: offset,
      returned_bytes: returnedBytes,
      next_offset_bytes: nextOffset,
      total_bytes: totalBytes,
      has_more: nextOffset < totalBytes,
      excerpt,
    };
  }
}

function hookReceiptKey(context: BeforeToolContext | AfterToolContext) {
  return (
    context.toolCall?.toolCallId ||
    `fetch_web_content:${JSON.stringify(context.input) ?? "unknown"}`
  );
}

function receiptReason(value: unknown) {
  const reason = recordValue(value).reason;
  return typeof reason === "string" && reason
    ? reason
    : "EXTERNAL_READ_SKIPPED";
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

function fetchRequestUrls(value: unknown) {
  const input = recordValue(value);
  const requests = Array.isArray(input.requests) ? input.requests : [];
  const urls = requests
    .map((request) => normalizedUrl(recordValue(request).url))
    .filter(Boolean);
  const direct = normalizedUrl(input.url);
  return urls.length ? urls : direct ? [direct] : [];
}

function failedFetchUrls(value: unknown) {
  if (!isAgentToolResult(value)) return [];
  return normalizedFetchOutput(value.output)
    .filter(fetchItemFailed)
    .map((item) => {
      const output = recordValue(item);
      return normalizedUrl(output.query ?? output.url);
    })
    .filter(Boolean);
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
    excerpt: boundedUtf8(serialized, externalResultContentBudgetBytes),
  };
}

function withExternalContinuation(
  result: unknown,
  receiptId: string,
  fullResult: unknown,
) {
  const continuation = {
    receipt_id: receiptId,
    next_offset_bytes: 0,
    total_bytes: serializedBytes(fullResult),
    tool: "inspect_external_read",
  };
  if (isAgentToolResult(result))
    return {
      ...result,
      metadata: {
        ...result.metadata,
        externalReadContinuation: continuation,
        externalReadTruncated: true,
      },
    };
  return {
    ...recordValue(result),
    continuation,
    truncated: true,
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
  const fetchSemantics =
    tool === "fetch_web_content" ? normalizedFetchSemantics(output) : undefined;
  const explicitOutcome = normalizedOutcome(result.outcome);
  const outcome = normalizedExternalOutcome(
    explicitOutcome,
    fetchSemantics,
    result.isError,
  );
  const fatal = result.fatal === true;
  return {
    ...result,
    outcome,
    fatal,
    reason:
      fetchSemantics?.outcome === "partial"
        ? fetchSemantics.reason
        : typeof result.reason === "string"
          ? result.reason
          : (fetchSemantics?.reason ?? externalOutcomeReason(outcome)),
    recommendation:
      fetchSemantics?.outcome === "partial"
        ? fetchSemantics.recommendation
        : typeof result.recommendation === "string"
          ? result.recommendation
          : (fetchSemantics?.recommendation ??
            externalOutcomeRecommendation(outcome)),
    output,
    isError: fatal,
    metadata: { ...result.metadata, ...fetchSemantics?.metadata },
  };
}

function normalizedExternalOutcome(
  explicit: string | undefined,
  fetchSemantics: ReturnType<typeof normalizedFetchSemantics>,
  isError: boolean | undefined,
) {
  if (fetchSemantics?.outcome === "partial") return "partial";
  if (explicit && explicit !== "completed") return explicit;
  if (fetchSemantics?.outcome && fetchSemantics.outcome !== "completed") {
    return fetchSemantics.outcome;
  }
  return (
    (isError ? "failed" : undefined) ??
    fetchSemantics?.outcome ??
    explicit ??
    "completed"
  );
}

function externalOutcomeReason(outcome: string) {
  return outcome === "failed"
    ? "EXTERNAL_READ_FAILED"
    : "EXTERNAL_READ_COMPLETED";
}

function externalOutcomeRecommendation(outcome: string) {
  return outcome === "failed"
    ? "Use the returned limitation and continue when possible."
    : "Continue with the task.";
}

function normalizedFetchSemantics(output: unknown) {
  const items = Array.isArray(output) ? output : [];
  const failed = items.filter(fetchItemFailed);
  if (!failed.length) return undefined;
  const succeeded = items.length - failed.length;
  const notFound = failed.every(fetchItemNotFound);
  return {
    outcome: succeeded ? "partial" : notFound ? "blocked" : "unavailable",
    reason: fetchReason(succeeded, notFound),
    recommendation: fetchRecommendation(succeeded, notFound),
    metadata: {
      externalReadFailedRequests: failed.length,
      externalReadSucceededRequests: succeeded,
    },
  };
}

function fetchReason(succeeded: number, notFound: boolean) {
  if (succeeded) return "EXTERNAL_READ_PARTIAL";
  return notFound ? "WEB_CONTENT_NOT_FOUND" : "EXTERNAL_READ_UNAVAILABLE";
}

function fetchRecommendation(succeeded: number, notFound: boolean) {
  if (succeeded)
    return "Use the successful results. Do not retry failed URLs in this turn.";
  if (notFound)
    return "The requested URLs do not exist. Do not guess nearby URLs; use one known index page only if documentation remains indispensable.";
  return "Continue from repository evidence. Retry only after the external service changes.";
}

function fetchItemFailed(value: unknown) {
  const item = recordValue(value);
  if (item.success === false || item.error) return true;
  return typeof item.status === "number" && item.status >= 400;
}

function fetchItemNotFound(value: unknown) {
  const item = recordValue(value);
  if (item.status === 404) return true;
  return /(?:\b404\b|not found)/iu.test(
    String(item.error ?? item.result ?? item.message ?? ""),
  );
}

function normalizedOutcome(value: unknown) {
  return typeof value === "string" &&
    [
      "applied",
      "blocked",
      "completed",
      "failed",
      "partial",
      "skipped",
      "unavailable",
    ].includes(value)
    ? value
    : undefined;
}

function normalizedFetchOutput(output: unknown): unknown[] {
  if (Array.isArray(output)) return output;
  if (typeof output === "string") {
    const parsed = parsedJson(output);
    return parsed === undefined ? [output] : normalizedFetchOutput(parsed);
  }
  const value = recordValue(output);
  for (const key of ["items", "results", "output"])
    if (Array.isArray(value[key])) return value[key] as unknown[];
  return output === undefined ? [] : [output];
}

function parsedJson(value: string) {
  const normalized = value.trim();
  if (!normalized.startsWith("[") && !normalized.startsWith("{"))
    return undefined;
  try {
    return JSON.parse(normalized) as unknown;
  } catch {
    return undefined;
  }
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
  let upperBound = externalResultContentBudgetBytes;
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
      ...externalResultSemantics(tool, result),
      fatal: false,
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

function externalResultSemantics(tool: ExternalReadToolName, result: object) {
  if (dynamicExternalRead(tool) && recordValue(result).available === false)
    return {
      outcome: "unavailable",
      reason: "PREVIEW_NOT_READY",
      recommendation:
        "Continue with local validation. Retry only after preview state changes.",
    };
  return {
    outcome: "completed",
    reason: "EXTERNAL_READ_COMPLETED",
    recommendation: "Continue with the task.",
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

function cachedSummary(value: unknown) {
  const serialized = JSON.stringify(value) ?? String(value);
  return boundedUtf8(serialized, 320);
}

function serializedBytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value) ?? String(value), "utf8");
}

function dynamicExternalRead(tool: ExternalReadToolName) {
  return ["get_preview_container_logs", "get_preview_devtools"].includes(tool);
}

function externalReadCacheTtl(tool: ExternalReadToolName, result: unknown) {
  const record = recordValue(result);
  const outcome = stringValue(record.outcome);
  if (dynamicExternalRead(tool)) return 5 * 60_000;
  if (outcome === "failed") return 2_000;
  if (tool === "fetch_web_content") return 5 * 60_000;
  return 30 * 60_000;
}

function externalReceiptFailure(reason: string) {
  return {
    outcome: "failed",
    fatal: false,
    isError: false,
    reason,
    recommendation:
      "Repeat the original external read only if it is still required.",
  };
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

function utf8Slice(value: string, offset: number, maximumBytes: number) {
  return boundedUtf8(
    Buffer.from(value, "utf8")
      .subarray(offset, offset + maximumBytes)
      .toString("utf8")
      .replace(/^\uFFFD/u, ""),
    maximumBytes,
  );
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
