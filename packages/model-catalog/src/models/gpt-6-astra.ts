import type { ModelInfo } from "@cline/shared";
import type { SupplementalModel } from "../types.js";

const astra: ModelInfo = {
  id: "gpt-6-astra",
  name: "GPT-6 Astra",
  family: "gpt-astra",
  operation: "language",
  status: "active",
  contextWindow: 1_050_000,
  maxInputTokens: 922_000,
  maxTokens: 128_000,
  capabilities: [
    "images",
    "tools",
    "reasoning",
    "structured_output",
    "prompt-cache",
  ],
  // Cline 0.0.82 rewrites max to xhigh on the wire. Offer only distinct,
  // working efforts until its official model/transport support takes over.
  reasoningOptions: [
    { type: "effort", values: ["low", "medium", "high", "xhigh"] },
  ],
  pricing: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
};

const source = "https://developers.openai.com/api/docs/models/gpt-6-astra";
const verifiedAt = "2026-09-10";

export const gpt6Astra: SupplementalModel[] = [
  { providerId: "openai-native", model: astra, source, verifiedAt },
  {
    providerId: "openai-codex",
    // Codex's model discovery advertises 872K max context and a 95% input
    // budget. Do not inherit the API's larger context or its billing rates.
    // "ultra" is a Codex orchestration mode, not a Cline reasoning effort.
    model: {
      ...astra,
      contextWindow: 872_000,
      maxInputTokens: 828_400,
      pricing: undefined,
    },
    source: `${source} (limits: Codex models discovery, gpt-6-astra)`,
    verifiedAt,
  },
];
