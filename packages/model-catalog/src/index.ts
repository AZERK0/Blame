import type { ModelInfo } from "@cline/llms"

const previewCapabilities: ModelInfo["capabilities"] = [
  "images",
  "files",
  "tools",
  "reasoning",
  "structured_output",
  "prompt-cache",
]

export const openAICodexPreviewModels = {
  "gpt-5.6-sol": {
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    status: "preview",
    capabilities: previewCapabilities,
    pricing: {
      input: 5,
      output: 30,
      cacheRead: 0.5,
      cacheWrite: 6.25,
    },
    releaseDate: "2026-07-09",
    family: "gpt",
  },
  "gpt-5.6-terra": {
    id: "gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    status: "preview",
    capabilities: previewCapabilities,
    pricing: {
      input: 2.5,
      output: 15,
      cacheRead: 0.25,
      cacheWrite: 3.125,
    },
    releaseDate: "2026-07-09",
    family: "gpt",
  },
  "gpt-5.6-luna": {
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    status: "preview",
    capabilities: previewCapabilities,
    pricing: {
      input: 1,
      output: 6,
      cacheRead: 0.1,
      cacheWrite: 1.25,
    },
    releaseDate: "2026-07-09",
    family: "gpt",
  },
} satisfies Record<string, ModelInfo>

export function knownOpenAICodexPreviewModels(
  providerId: string,
  modelId: string
) {
  if (providerId !== "openai-codex") return undefined
  if (!(modelId in openAICodexPreviewModels)) return undefined
  return openAICodexPreviewModels
}
