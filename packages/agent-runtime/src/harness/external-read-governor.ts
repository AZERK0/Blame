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
  | { action: "execute"; normalized: string; receiptId: string }
  | { action: "return"; result: unknown };

const maximumExternalResultBytes = 16_000;
type AgentHooks = NonNullable<CoreSessionConfig["hooks"]>;
type AfterToolContext = Parameters<NonNullable<AgentHooks["afterTool"]>>[0];
type BeforeToolContext = Parameters<NonNullable<AgentHooks["beforeTool"]>>[0];

export class ExternalReadGovernor {
  private readonly cache = new Map<string, CachedExternalRead>();
  private readonly history: CachedExternalRead[] = [];
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly metrics: ExternalReadMetrics = {
    cacheHits: 0,
    calls: 0,
    returnedBytes: 0,
    suppressed: 0,
  };

  wrap(tool: AgentTool): AgentTool {
    const toolName = tool.name;
    if (!isExternalReadTool(toolName)) return tool;
    return {
      ...tool,
      execute: async (input: unknown, context: AgentToolContext) => {
        const decision = this.before(toolName, input);
        if (decision.action === "return") return decision.result;
        const pending = this.inFlight.get(decision.receiptId);
        if (pending) return this.afterInFlight(pending, decision.receiptId);
        const execution = Promise.resolve(tool.execute(input, context))
          .then((result: unknown) =>
            this.after(toolName, input, decision, result),
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
      beforeTool: ({ tool, input }: BeforeToolContext) => {
        if (tool.name !== "fetch_web_content") return undefined;
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
  ): ExternalReadDecision {
    this.metrics.calls += 1;
    const normalized = normalizedExternalRead(tool, input);
    const receiptId = `external-read://${sha256(`${tool}\0${normalized}`)}`;
    const cached = this.cache.get(receiptId);
    if (cached) return this.cachedReceipt(cached);
    const similar = this.history.filter((entry) =>
      stronglyOverlaps(entry, normalized),
    );
    if (similar.length >= 2)
      return this.suppressedReceipt(receiptId, similar.at(-1));
    return { action: "execute", normalized, receiptId };
  }

  private pendingDecision(
    input: unknown,
  ): Extract<ExternalReadDecision, { action: "execute" }> {
    const normalized = normalizedExternalRead("fetch_web_content", input);
    return {
      action: "execute",
      normalized,
      receiptId: `external-read://${sha256(`fetch_web_content\0${normalized}`)}`,
    };
  }

  private after(
    tool: ExternalReadToolName,
    input: unknown,
    decision: Extract<ExternalReadDecision, { action: "execute" }>,
    result: unknown,
  ) {
    const bounded = boundedExternalResult(result);
    const entry = {
      input,
      normalized: decision.normalized,
      receiptId: decision.receiptId,
      result: bounded,
    };
    this.cache.set(entry.receiptId, entry);
    this.history.push(entry);
    if (this.history.length > 100) {
      const evicted = this.history.shift();
      if (evicted) this.cache.delete(evicted.receiptId);
    }
    this.metrics.returnedBytes += serializedBytes(bounded);
    return boundedResult(bounded, entry.receiptId, tool, this.publicMetrics());
  }

  private cachedReceipt(
    entry: CachedExternalRead,
  ): Extract<ExternalReadDecision, { action: "return" }> {
    this.metrics.cacheHits += 1;
    this.metrics.suppressed += 1;
    return {
      action: "return",
      result: {
        status: "already_available",
        alreadyAvailable: true,
        receiptId: entry.receiptId,
        sourceUnchanged: true,
        governor: this.publicMetrics(),
      },
    };
  }

  private async afterInFlight(pending: Promise<unknown>, receiptId: string) {
    await pending;
    const cached = this.cache.get(receiptId);
    if (!cached) throw new Error("External read completed without a cache receipt.");
    return this.cachedReceipt(cached).result;
  }

  private suppressedReceipt(
    receiptId: string,
    previous?: CachedExternalRead,
  ): Extract<ExternalReadDecision, { action: "return" }> {
    this.metrics.suppressed += 1;
    return {
      action: "return",
      result: {
        status: "retry_suppressed",
        retrySuppressed: true,
        receiptId,
        previousReceiptId: previous?.receiptId,
        reason: "REPEATED_EXTERNAL_READ",
        recommendation:
          "Use the existing receipts or continue with a targeted workspace action.",
        governor: this.publicMetrics(),
      },
    };
  }

  private publicMetrics() {
    return {
      external_read_call_count: this.metrics.calls,
      external_read_cache_hit_count: this.metrics.cacheHits,
      external_read_suppressed_count: this.metrics.suppressed,
      external_read_returned_bytes: this.metrics.returnedBytes,
    };
  }
}

function normalizedExternalRead(tool: ExternalReadToolName, input: unknown) {
  const value = recordValue(input);
  const requests = Array.isArray(value.requests)
    ? value.requests.map(normalizedFetchRequest).sort().join("|")
    : "";
  const url = normalizedUrl(value.url);
  const query = normalizedText(
    String(value.prompt ?? value.query ?? value.task ?? value.context ?? ""),
  );
  const scope = [value.specialist, value.service, value.tailLines]
    .filter((item) => item !== undefined)
    .map((item) => normalizedText(String(item)))
    .join(":");
  return `${tool}:${requests || url}:${scope}:${query}`;
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
    url.searchParams.sort();
    return url.toString().toLowerCase();
  } catch {
    return normalizedText(value);
  }
}

function normalizedText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

function stronglyOverlaps(entry: CachedExternalRead, normalized: string) {
  const left = new Set(
    entry.normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean),
  );
  const right = new Set(normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  if (!left.size || !right.size) return entry.normalized === normalized;
  const shared = [...left].filter((token) => right.has(token)).length;
  return shared / Math.min(left.size, right.size) >= 0.75;
}

function boundedExternalResult(result: unknown) {
  if (serializedBytes(result) <= maximumExternalResultBytes) return result;
  const serialized = JSON.stringify(result) ?? String(result);
  return {
    status: "bounded",
    truncated: true,
    excerpt: boundedUtf8(serialized, maximumExternalResultBytes - 256),
  };
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
  governor: Record<string, number>,
) {
  if (isAgentToolResult(result))
    return {
      ...result,
      metadata: {
        ...result.metadata,
        externalReadReceiptId: receiptId,
        governor,
      },
    };
  if (result && typeof result === "object" && !Array.isArray(result))
    return { ...result, externalReadReceiptId: receiptId, governor, tool };
  return { content: result, externalReadReceiptId: receiptId, governor, tool };
}

function isAgentToolResult(value: unknown): value is {
  isError?: boolean;
  metadata?: Record<string, unknown>;
  output: unknown;
} {
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

function serializedBytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value) ?? String(value), "utf8");
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
