import type {
  CoreCompactionConfig,
  CoreCompactionContext,
  CoreCompactionResult,
} from "@cline/sdk";
import { compress } from "headroom-ai";

import { blameCompactionConfig } from "./production.js";
import type { ProductionConfig } from "./production.js";
import type { AgentContextCompressionMode } from "./types.js";

type CompactionMessage = CoreCompactionContext["messages"][number];
type ContextCompressionLogger = (
  message: string,
  payload?: unknown,
) => void | Promise<void>;

const defaultHeadroomTimeoutMs = 15_000;
const defaultHeadroomFallback = true;
const defaultHeadroomRetries = 1;

export function contextCompressionConfig(
  productionConfig: ProductionConfig,
  mode: AgentContextCompressionMode | undefined,
  logger?: ContextCompressionLogger,
): CoreCompactionConfig {
  const selectedMode = mode ?? "cline";
  if (selectedMode === "off") return { enabled: false };
  if (selectedMode === "headroom") {
    return headroomCompactionConfig(productionConfig, logger);
  }
  return blameCompactionConfig(productionConfig);
}

function headroomCompactionConfig(
  productionConfig: ProductionConfig,
  logger?: ContextCompressionLogger,
): CoreCompactionConfig {
  return {
    enabled: true,
    ...(productionConfig.compactionMaxInputTokens
      ? { maxInputTokens: productionConfig.compactionMaxInputTokens }
      : {}),
    ...(productionConfig.compactionReserveTokens
      ? { reserveTokens: productionConfig.compactionReserveTokens }
      : {}),
    ...(productionConfig.compactionThresholdRatio
      ? { thresholdRatio: productionConfig.compactionThresholdRatio }
      : {}),
    compact: (context: CoreCompactionContext) => headroomCompact(context, logger),
  };
}

async function headroomCompact(
  context: CoreCompactionContext,
  logger?: ContextCompressionLogger,
): Promise<CoreCompactionResult | undefined> {
  await logHeadroomCompression(logger, "headroom compaction started", {
    maxInputTokens: context.maxInputTokens,
    messageCount: context.messages.length,
    modelId: context.model.id,
    tokenBudget: context.maxInputTokens,
  });
  const result = await safeHeadroomCompress(context, logger);
  await logHeadroomCompression(logger, "headroom compaction completed", {
    ccrHashCount: result.ccrHashes.length,
    compressed: result.compressed,
    compressionRatio: result.compressionRatio,
    fallback: !result.compressed,
    messageCountAfter: result.messages.length,
    messageCountBefore: context.messages.length,
    tokensAfter: result.tokensAfter,
    tokensBefore: result.tokensBefore,
    tokensSaved: result.tokensSaved,
    transformsApplied: result.transformsApplied,
  });
  if (!result.compressed) return undefined;
  const messages = result.messages as CoreCompactionResult["messages"];
  return {
    messages: messages.map((message: CompactionMessage, index: number) => {
      const original = context.messages[index];
      return original ? { ...original, ...message } : message;
    }),
  };
}

async function safeHeadroomCompress(
  context: CoreCompactionContext,
  logger?: ContextCompressionLogger,
) {
  try {
    return await compress(context.messages, {
      fallback: defaultHeadroomFallback,
      model: context.model.id,
      retries: defaultHeadroomRetries,
      stack: "blame-agent-runtime",
      timeout: defaultHeadroomTimeoutMs,
      tokenBudget: context.maxInputTokens,
    });
  } catch (error) {
    await logHeadroomCompression(logger, "headroom compaction failed", {
      error: errorMessage(error),
      fallback: true,
    });
    return {
      ccrHashes: [],
      compressed: false,
      compressionRatio: 1,
      messages: context.messages,
      tokensAfter: 0,
      tokensBefore: 0,
      tokensSaved: 0,
      transformsApplied: [],
    };
  }
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
