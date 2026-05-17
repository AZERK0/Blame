import { getAllProviders, getModelsForProvider } from "@cline/llms"
import type { ModelInfo, ProviderInfo } from "@cline/llms"

import type { BlameModel, BlameProvider } from "./types.js"

export async function listClineProviders() {
  const providers: ProviderInfo[] = await getAllProviders()
  const withModels: BlameProvider[] = await Promise.all(
    providers.map((provider) => toBlameProvider(provider))
  )
  return withModels.filter((provider: BlameProvider) => Object.keys(provider.models).length > 0)
}

async function toBlameProvider(provider: ProviderInfo): Promise<BlameProvider> {
  const models = await getModelsForProvider(provider.id)

  return {
    id: provider.id,
    name: provider.name,
    description: provider.description,
    baseUrl: provider.baseUrl,
    defaultModelId: provider.defaultModelId,
    capabilities: provider.capabilities,
    models: Object.fromEntries(
      Object.entries(models).map(([modelId, model]) => [modelId, toBlameModel(modelId, model)])
    ),
  }
}

function toBlameModel(modelId: string, model: ModelInfo): BlameModel {
  return {
    id: model.id ?? modelId,
    name: model.name ?? modelId,
    status: model.status,
    description: model.description,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    capabilities: model.capabilities,
    cost: {
      input: model.pricing?.input ?? 0,
      output: model.pricing?.output ?? 0,
    },
    variants: {
      releaseDate: model.releaseDate,
      deprecationDate: model.deprecationDate,
      deprecationNotice: model.deprecationNotice,
      replacedBy: model.replacedBy,
      family: model.family,
    },
  }
}
