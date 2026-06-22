import type { AgentPlugin, CoreCompactionConfig, Message } from "@cline/sdk";
import { compress } from "headroom-ai";

import { blameCompactionConfig } from "./production.js";
import type { ProductionConfig } from "./production.js";
import type { AgentContextCompressionMode } from "./types.js";

type ContextCompressionLogger = (
  message: string,
  payload?: unknown,
) => void | Promise<void>;
type AgentPluginSetupApi = Parameters<NonNullable<AgentPlugin["setup"]>>[0];
type ContextCompressionOptions = {
  logger?: ContextCompressionLogger;
  modelId?: string;
};
type HeadroomLimits = {
  estimatedInputTokens: number;
  maxInputTokens: number;
  targetTokens: number;
  triggerTokens: number;
};
type MessageStats = {
  messageCount: number;
  tokensBefore: number;
  toolResultTokens: number;
};
type HeadroomCompressionResult = Awaited<ReturnType<typeof compress>>;

const defaultHeadroomTimeoutMs = 15_000;
const defaultHeadroomFallback = true;
const defaultHeadroomRetries = 1;
const defaultHeadroomMaxInputTokens = 100_000;
const defaultHeadroomReserveTokens = 4_000;
const defaultHeadroomTriggerRatio = 0.35;
const defaultHeadroomTargetRatio = 0.7;
const defaultHeadroomLargeToolResultTokens = 8_000;
const minimumHeadroomTokenBudget = 4_000;

export function contextCompressionConfig(
  productionConfig: ProductionConfig,
  mode: AgentContextCompressionMode | undefined,
): CoreCompactionConfig {
  const selectedMode = mode ?? "cline";
  if (selectedMode === "off") return { enabled: false };
  if (selectedMode === "headroom") return { enabled: false };
  return blameCompactionConfig(productionConfig);
}

export function contextCompressionExtensions(
  productionConfig: ProductionConfig,
  mode: AgentContextCompressionMode | undefined,
  options: ContextCompressionOptions = {},
): AgentPlugin[] | undefined {
  if (mode !== "headroom") return undefined;
  return [headroomMessageBuilderExtension(productionConfig, options)];
}

function headroomMessageBuilderExtension(
  productionConfig: ProductionConfig,
  options: ContextCompressionOptions,
): AgentPlugin {
  return {
    name: "blame-headroom-provider-compression",
    manifest: {
      capabilities: ["messageBuilders"],
    },
    setup(api: AgentPluginSetupApi) {
      api.registerMessageBuilder({
        name: "headroom-provider-bound-compression",
        build: (messages: Message[]) =>
          headroomProviderMessages(messages, productionConfig, options),
      });
    },
  };
}

async function headroomProviderMessages(
  messages: Message[],
  productionConfig: ProductionConfig,
  options: ContextCompressionOptions,
): Promise<Message[]> {
  const stats = messageStats(messages);
  const limits = headroomLimits(productionConfig, stats.tokensBefore);
  if (!shouldCompress(stats, limits)) {
    return skippedHeadroomMessages(messages, stats, limits, options.logger);
  }
  return compressedHeadroomMessages(messages, stats, limits, options);
}

async function skippedHeadroomMessages(
  messages: Message[],
  stats: MessageStats,
  limits: HeadroomLimits,
  logger?: ContextCompressionLogger,
): Promise<Message[]> {
  await logHeadroomCompression(
    logger,
    "headroom provider compression skipped",
    {
      estimatedInputTokens: limits.estimatedInputTokens,
      maxInputTokens: limits.maxInputTokens,
      messageCount: stats.messageCount,
      reason: "below-threshold",
      targetTokens: limits.targetTokens,
      toolResultTokens: stats.toolResultTokens,
      triggerTokens: limits.triggerTokens,
    },
  );
  return messages;
}

async function compressedHeadroomMessages(
  messages: Message[],
  stats: MessageStats,
  limits: HeadroomLimits,
  options: ContextCompressionOptions,
): Promise<Message[]> {
  await logHeadroomCompression(
    options.logger,
    "headroom provider compression started",
    headroomStartedPayload(stats, limits, options.modelId),
  );

  try {
    const result = await compress(messages, {
      fallback: defaultHeadroomFallback,
      model: options.modelId,
      retries: defaultHeadroomRetries,
      stack: "blame-agent-runtime",
      timeout: defaultHeadroomTimeoutMs,
      tokenBudget: limits.targetTokens,
    });
    await logHeadroomCompression(
      options.logger,
      "headroom provider compression completed",
      headroomCompletedPayload(result, stats, limits),
    );
    return headroomResultMessages(result, messages);
  } catch (error) {
    await logHeadroomCompression(
      options.logger,
      "headroom provider compression failed",
      {
        error: errorMessage(error),
        fallback: true,
      },
    );
    return messages;
  }
}

function headroomStartedPayload(
  stats: MessageStats,
  limits: HeadroomLimits,
  modelId: string | undefined,
) {
  return {
    estimatedInputTokens: limits.estimatedInputTokens,
    maxInputTokens: limits.maxInputTokens,
    messageCount: stats.messageCount,
    modelId,
    targetTokens: limits.targetTokens,
    toolResultTokens: stats.toolResultTokens,
    triggerTokens: limits.triggerTokens,
  };
}

function headroomCompletedPayload(
  result: HeadroomCompressionResult,
  stats: MessageStats,
  limits: HeadroomLimits,
) {
  return {
    ccrHashCount: result.ccrHashes.length,
    compressed: result.compressed,
    compressionRatio: result.compressionRatio,
    fallback: !result.compressed,
    estimatedInputTokens: limits.estimatedInputTokens,
    messageCountAfter: result.messages.length,
    messageCountBefore: stats.messageCount,
    targetTokens: limits.targetTokens,
    tokensAfter: result.tokensAfter,
    tokensBefore: result.tokensBefore,
    tokensSaved: result.tokensSaved,
    transformsApplied: result.transformsApplied.join(","),
  };
}

function headroomResultMessages(
  result: HeadroomCompressionResult,
  fallback: Message[],
) {
  return result.compressed && Array.isArray(result.messages)
    ? (result.messages as Message[])
    : fallback;
}

async function logHeadroomCompression(
  logger: ContextCompressionLogger | undefined,
  message: string,
  payload: unknown,
) {
  try {
    await logger?.(message, payload);
  } catch {
    return;
  }
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown Headroom compression error";
}

function headroomLimits(
  productionConfig: ProductionConfig,
  estimatedInputTokens: number,
): HeadroomLimits {
  const maxInputTokens =
    productionConfig.compactionMaxInputTokens ?? defaultHeadroomMaxInputTokens;
  const reserveTokens =
    productionConfig.compactionReserveTokens ?? defaultHeadroomReserveTokens;
  const thresholdRatio =
    productionConfig.compactionThresholdRatio ?? defaultHeadroomTriggerRatio;
  const triggerTokens = Math.max(
    minimumHeadroomTokenBudget,
    Math.floor(maxInputTokens * thresholdRatio),
  );
  const hardTarget = Math.max(
    minimumHeadroomTokenBudget,
    maxInputTokens - reserveTokens,
  );
  const proportionalTarget = Math.max(
    minimumHeadroomTokenBudget,
    Math.floor(estimatedInputTokens * defaultHeadroomTargetRatio),
  );
  return {
    estimatedInputTokens,
    maxInputTokens,
    targetTokens: Math.min(hardTarget, proportionalTarget),
    triggerTokens,
  };
}

function shouldCompress(stats: MessageStats, limits: HeadroomLimits) {
  return (
    stats.tokensBefore >= limits.triggerTokens ||
    stats.toolResultTokens >= defaultHeadroomLargeToolResultTokens
  );
}

function messageStats(messages: Message[]): MessageStats {
  const tokenCounts = messages.map(estimateMessageTokens);
  return {
    messageCount: messages.length,
    tokensBefore: tokenCounts.reduce((total, tokens) => total + tokens, 0),
    toolResultTokens: largestToolResultTokens(messages),
  };
}

function estimateMessageTokens(message: Message) {
  return estimateTokensFromChars(serializedMessage(message).length);
}

function largestToolResultTokens(messages: Message[]) {
  let largest = 0;
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (blockType(block) !== "tool_result") continue;
      largest = Math.max(
        largest,
        estimateTokensFromChars(toolResultText(block).length),
      );
    }
  }
  return largest;
}

function serializedMessage(message: Message) {
  if (typeof message.content === "string") {
    return `[${message.role}]: ${message.content}`;
  }
  return message.content
    .map(
      (block: unknown) =>
        `[${message.role} ${blockType(block)}]: ${contentBlockText(block)}`,
    )
    .join("\n");
}

function contentBlockText(block: unknown): string {
  const record = recordValue(block);
  if (!record) return primitiveText(block);
  if (record.type === "text") return primitiveText(record.text);
  if (record.type === "file")
    return `${primitiveText(record.path)}\n${primitiveText(record.content)}`;
  if (record.type === "image") return primitiveText(record.mediaType);
  if (record.type === "thinking") return primitiveText(record.thinking);
  if (record.type === "redacted_thinking") return primitiveText(record.data);
  if (record.type === "tool_use")
    return `${primitiveText(record.name)}\n${safeJson(record.input)}`;
  if (record.type === "tool_result") return toolResultText(record);
  return safeJson(block);
}

function toolResultText(block: unknown): string {
  return toolResultContentText(recordValue(block)?.content);
}

function toolResultContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(contentBlockText).join("\n");
  return primitiveText(content);
}

function blockType(block: unknown): string {
  const type = recordValue(block)?.type;
  return typeof type === "string" ? type : "unknown";
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  return value as Record<string, unknown>;
}

function primitiveText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return safeJson(value);
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function estimateTokensFromChars(chars: number) {
  return Math.ceil(chars / 3);
}
