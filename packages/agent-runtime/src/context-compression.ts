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

const defaultHeadroomTimeoutMs = 15_000;
const defaultHeadroomFallback = true;
const defaultHeadroomRetries = 1;

export function contextCompressionConfig(
  productionConfig: ProductionConfig,
  mode: AgentContextCompressionMode | undefined,
): CoreCompactionConfig {
  const selectedMode = mode ?? "cline";
  if (selectedMode === "off") return { enabled: false };
  if (selectedMode === "headroom") return headroomCompactionConfig(productionConfig);
  return blameCompactionConfig(productionConfig);
}

function headroomCompactionConfig(
  productionConfig: ProductionConfig,
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
    compact: headroomCompact,
  };
}

async function headroomCompact(
  context: CoreCompactionContext,
): Promise<CoreCompactionResult | undefined> {
  const result = await safeHeadroomCompress(context);
  if (!result.compressed) return undefined;
  const messages = result.messages as CoreCompactionResult["messages"];
  return {
    messages: messages.map((message: CompactionMessage, index: number) => {
      const original = context.messages[index];
      return original ? { ...original, ...message } : message;
    }),
  };
}

async function safeHeadroomCompress(context: CoreCompactionContext) {
  try {
    return await compress(context.messages, {
      fallback: defaultHeadroomFallback,
      model: context.model.id,
      retries: defaultHeadroomRetries,
      stack: "blame-agent-runtime",
      timeout: defaultHeadroomTimeoutMs,
      tokenBudget: context.maxInputTokens,
    });
  } catch {
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
