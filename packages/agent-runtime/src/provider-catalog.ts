import { openAICodexPreviewModels } from "@blame/model-catalog";
import { getAllProviders, getModelsForProvider } from "@cline/llms";
import type { ModelInfo, ProviderInfo } from "@cline/llms";

import type { BlameModel, BlameProvider } from "./types.js";

const externalCliProviderIds = new Set(["claude-code", "openai-codex-cli"]);

export async function listClineProviders() {
  const providers: ProviderInfo[] = await getAllProviders();
  const withModels: BlameProvider[] = await Promise.all(
    providers
      .filter((provider) => isBaseRuntimeProvider(provider.id))
      .map((provider) => toBlameProvider(provider)),
  );
  return withModels.filter(
    (provider: BlameProvider) => Object.keys(provider.models).length > 0,
  );
}

export function isBaseRuntimeProvider(providerId: string) {
  return !externalCliProviderIds.has(providerId);
}

async function toBlameProvider(provider: ProviderInfo): Promise<BlameProvider> {
  const models = await getModelsForProvider(provider.id);
  const providerModels = providerModelsWithPreview(provider.id, models);

  return {
    id: provider.id,
    name: provider.name,
    description: provider.description,
    baseUrl: provider.baseUrl,
    defaultModelId: provider.defaultModelId,
    capabilities: provider.capabilities,
    models: Object.fromEntries(
      Object.entries(providerModels).map(([modelId, model]) => [
        modelId,
        toBlameModel(modelId, model),
      ]),
    ),
  };
}

function providerModelsWithPreview(
  providerId: string,
  models: Record<string, ModelInfo>,
) {
  if (providerId !== "openai-codex") return models;
  return {
    ...openAICodexPreviewModels,
    ...models,
  };
}

function toBlameModel(modelId: string, model: ModelInfo): BlameModel {
  const variants = model.capabilities?.includes("reasoning")
    ? {
        low: { reasoningEffort: "low" },
        medium: { reasoningEffort: "medium" },
        high: { reasoningEffort: "high" },
        xhigh: { reasoningEffort: "xhigh" },
      }
    : undefined;

  return {
    id: model.id ?? modelId,
    name: model.name ?? modelId,
    status: model.status,
    description: model.description,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    capabilities: model.capabilities,
    releaseDate: model.releaseDate,
    cost: {
      input: model.pricing?.input ?? null,
      output: model.pricing?.output ?? null,
      cacheRead: model.pricing?.cacheRead ?? null,
      cacheWrite: model.pricing?.cacheWrite ?? null,
    },
    variants,
  };
}
