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
  compressor?: typeof compress;
  headroomBaseUrl?: string;
  logger?: ContextCompressionLogger;
  modelId?: string;
};
type PreparedHeadroomMessages = {
  input: "native" | "text-transcript";
  messages: Message[];
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
const defaultHeadroomFallback = false;
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
    return skippedHeadroomMessages(
      messages,
      stats,
      limits,
      options.logger,
      "below-threshold",
    );
  }
  return compressedHeadroomMessages(
    prepareHeadroomMessages(messages),
    messages,
    stats,
    limits,
    options,
  );
}

async function skippedHeadroomMessages(
  messages: Message[],
  stats: MessageStats,
  limits: HeadroomLimits,
  logger?: ContextCompressionLogger,
  reason = "below-threshold",
): Promise<Message[]> {
  await logHeadroomCompression(
    logger,
    "headroom provider compression skipped",
    {
      estimatedInputTokens: limits.estimatedInputTokens,
      maxInputTokens: limits.maxInputTokens,
      messageCount: stats.messageCount,
      reason,
      targetTokens: limits.targetTokens,
      toolResultTokens: stats.toolResultTokens,
      triggerTokens: limits.triggerTokens,
    },
  );
  return messages;
}

async function compressedHeadroomMessages(
  prepared: PreparedHeadroomMessages,
  fallback: Message[],
  stats: MessageStats,
  limits: HeadroomLimits,
  options: ContextCompressionOptions,
): Promise<Message[]> {
  await logHeadroomCompression(
    options.logger,
    "headroom provider compression started",
    headroomStartedPayload(stats, limits, options),
  );

  try {
    const compressor = options.compressor ?? compress;
    const result = await compressor(prepared.messages, {
      baseUrl: options.headroomBaseUrl,
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
      headroomCompletedPayload(result, stats, limits, prepared),
    );
    return await headroomResultMessages(result, fallback, options.logger);
  } catch (error) {
    await logHeadroomCompression(
      options.logger,
      "headroom provider compression failed",
      {
        error: errorMessage(error),
        fallback: true,
      },
    );
    return fallback;
  }
}

function headroomStartedPayload(
  stats: MessageStats,
  limits: HeadroomLimits,
  options: ContextCompressionOptions,
) {
  return {
    estimatedInputTokens: limits.estimatedInputTokens,
    maxInputTokens: limits.maxInputTokens,
    messageCount: stats.messageCount,
    headroomBaseUrl: options.headroomBaseUrl,
    modelId: options.modelId,
    targetTokens: limits.targetTokens,
    toolResultTokens: stats.toolResultTokens,
    triggerTokens: limits.triggerTokens,
  };
}

function headroomCompletedPayload(
  result: HeadroomCompressionResult,
  stats: MessageStats,
  limits: HeadroomLimits,
  prepared: PreparedHeadroomMessages,
) {
  return {
    ccrHashCount: result.ccrHashes.length,
    compressed: result.compressed,
    compressionRatio: result.compressionRatio,
    fallback: !result.compressed,
    headroomInput: prepared.input,
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

async function headroomResultMessages(
  result: HeadroomCompressionResult,
  fallback: Message[],
  logger?: ContextCompressionLogger,
) {
  if (!result.compressed || !Array.isArray(result.messages)) return fallback;
  const messages = result.messages as Message[];
  const toolIssue = toolStructureIssue(messages);
  if (!toolIssue) return messages;
  await logHeadroomCompression(
    logger,
    "headroom provider compression rejected",
    {
      fallback: true,
      messageCount: messages.length,
      reason: toolIssue,
    },
  );
  return fallback;
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

function prepareHeadroomMessages(messages: Message[]): PreparedHeadroomMessages {
  if (!hasToolHistory(messages)) return { input: "native", messages };
  return {
    input: "text-transcript",
    messages: textTranscriptMessages(messages),
  };
}

function hasToolHistory(messages: Message[]) {
  return messages.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some((block: unknown) => toolBlock(recordValue(block))),
  );
}

function toolStructureIssue(messages: Message[]) {
  const pendingToolUseIds = new Set<string>();
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      const record = recordValue(block);
      if (record?.type === "tool_use") {
        const id = stringField(record.id);
        if (id) pendingToolUseIds.add(id);
      }
      if (record?.type === "tool_result") {
        const id = stringField(record.tool_use_id);
        if (!id || !pendingToolUseIds.has(id)) return "orphan-tool-result";
        pendingToolUseIds.delete(id);
      }
    }
  }
  return pendingToolUseIds.size ? "pending-tool-use" : undefined;
}

function toolBlock(record: Record<string, unknown> | undefined) {
  return record?.type === "tool_use" || record?.type === "tool_result";
}

function textTranscriptMessage(message: Message): Message {
  if (typeof message.content === "string") return message;
  if (!Array.isArray(message.content)) return message;
  return {
    ...message,
    content: message.content.map(transcriptBlockText).filter(Boolean).join("\n"),
  };
}

function textTranscriptMessages(messages: Message[]): Message[] {
  return [
    {
      role: "assistant",
      content: transcriptText(messages),
    },
    {
      role: "user",
      content: continuationPrompt(messages),
    },
  ] as Message[];
}

function transcriptText(messages: Message[]) {
  return messages
    .map((message) => `[${message.role}]\n${textTranscriptMessage(message).content}`)
    .join("\n\n");
}

function continuationPrompt(messages: Message[]) {
  return lastUserText(messages) || "Continue the task using the transcript.";
}

function lastUserText(messages: Message[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    const text = textOnlyContent(message.content);
    if (text) return text;
  }
  return undefined;
}

function textOnlyContent(content: Message["content"]) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const record = recordValue(block);
      return record?.type === "text" ? primitiveText(record.text) : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function transcriptBlockText(block: unknown) {
  const record = recordValue(block);
  if (record?.type === "tool_use") {
    const name = primitiveText(record.name) || "tool";
    return `Tool call ${name}: ${safeJson(record.input)}`;
  }
  if (record?.type === "tool_result") {
    return `Tool result: ${toolResultText(record)}`;
  }
  return contentBlockText(block);
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

function stringField(value: unknown) {
  return typeof value === "string" && value.length ? value : undefined;
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
