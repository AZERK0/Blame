import ModelCatalogSnapshot from '#models/model_catalog_snapshot'
import type ProviderCredential from '#models/provider_credential'
import {
  type CatalogModel,
  type CatalogProvider,
  type CatalogSnapshotPayload,
  type OpenRouterModel,
} from '#services/model_catalog_contract'
import {
  fetchClineLiveProviderModels,
  loadClineProviderCatalog,
} from '#services/cline_catalog_client'
import { ModelCatalogMatcher } from '#services/model_catalog_matcher'
import { buildModelRecommendations } from '#services/model_recommendation_service'
import ModelUsageProfileService from '#services/model_usage_profile_service'
import { fetchOpenRouterCatalog } from '#services/openrouter_catalog_client'
import { credentialModelIds } from '#services/provider_credentials_service'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'
import { openAICodexPreviewModels } from '@blame/model-catalog'
import type { ModelInfo, ProviderInfo } from '@cline/llms'
import { createHash } from 'node:crypto'
import { DateTime } from 'luxon'

const snapshotId = 'global'
const catalogPolicyVersion = 3
const externalCliProviderIds = new Set(['claude-code', 'openai-codex-cli'])
let authoritativeProviderIds = new Set<string>()
let staticCatalogPromise: Promise<CatalogProvider[]> | undefined
let refreshPromise: Promise<ModelCatalogSnapshot> | undefined

export default class ModelCatalogService {
  async catalog(userId: string, credentials: ProviderCredential[]) {
    const snapshot = await this.snapshot()
    const payload = parseSnapshot(snapshot)
    const providers = addCredentialModels(
      payload.providers,
      credentials,
      payload.openRouterModels ?? []
    )
    const connected = Array.from(new Set(credentials.map((credential) => credential.providerId)))
    const profile = await new ModelUsageProfileService().forUser(userId)
    return {
      all: providers,
      default: providerDefaults(providers),
      recommendations: buildModelRecommendations(
        providers,
        connected,
        profile,
        payload.generatedAt
      ),
    }
  }

  private async snapshot() {
    const staticCatalog = await loadStaticCatalog()
    const catalogHash = hashCatalog(staticCatalog)
    const existing = await ModelCatalogSnapshot.find(snapshotId)
    if (!existing || existing.catalogHash !== catalogHash) {
      return refreshCatalog(staticCatalog, catalogHash, existing)
    }
    if (snapshotStale(existing)) triggerRefresh(staticCatalog, catalogHash, existing)
    return existing
  }
}

function loadStaticCatalog() {
  staticCatalogPromise ??= buildStaticCatalog()
  return staticCatalogPromise
}

async function buildStaticCatalog() {
  const catalog = await loadClineProviderCatalog()
  const providers = catalog.filter(({ provider }) => !externalCliProviderIds.has(provider.id))
  authoritativeProviderIds = new Set(
    providers
      .filter(({ authoritativeModels }) => authoritativeModels)
      .map(({ provider }) => provider.id)
  )
  return providers.map(({ provider, models }) =>
    catalogProvider(provider, withPreviewModels(provider.id, models))
  )
}

function withPreviewModels(providerId: string, models: Record<string, ModelInfo>) {
  if (providerId !== 'openai-codex') return models
  return { ...openAICodexPreviewModels, ...models }
}

function catalogProvider(provider: ProviderInfo, models: Record<string, ModelInfo>) {
  return {
    id: provider.id,
    name: provider.name,
    description: provider.description,
    baseUrl: provider.baseUrl,
    defaultModelId: provider.defaultModelId,
    capabilities: provider.capabilities,
    models: Object.fromEntries(
      Object.entries(models).map(([modelId, model]) => [modelId, catalogModel(modelId, model)])
    ),
  } satisfies CatalogProvider
}

function catalogModel(modelId: string, model: ModelInfo): CatalogModel {
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
    variants: reasoningVariants(model),
  }
}

function reasoningVariants(model: ModelInfo) {
  if (!model.capabilities?.includes('reasoning')) return undefined
  return {
    low: { reasoningEffort: 'low' },
    medium: { reasoningEffort: 'medium' },
    high: { reasoningEffort: 'high' },
    xhigh: { reasoningEffort: 'xhigh' },
  }
}

function refreshCatalog(
  staticCatalog: CatalogProvider[],
  catalogHash: string,
  previous: ModelCatalogSnapshot | null
) {
  refreshPromise ??= performRefresh(staticCatalog, catalogHash, previous).finally(() => {
    refreshPromise = undefined
  })
  return refreshPromise
}

async function performRefresh(
  staticCatalog: CatalogProvider[],
  catalogHash: string,
  previous: ModelCatalogSnapshot | null
) {
  const providers = await refreshedProviders(staticCatalog)
  const openRouterModels = await loadOpenRouterModels()
  const enriched = enrichProviders(providers, openRouterModels, previous)
  const references = openRouterModels.length
    ? openRouterModels
    : ((previous && parseSnapshot(previous).openRouterModels) ?? [])
  const generatedAt = DateTime.utc()
  return ModelCatalogSnapshot.updateOrCreate(
    { id: snapshotId },
    {
      catalogHash,
      payload: JSON.stringify({
        generatedAt: generatedAt.toISO(),
        openRouterModels: references,
        providers: enriched,
      }),
      refreshedAt: generatedAt,
    }
  )
}

async function refreshedProviders(staticCatalog: CatalogProvider[]) {
  if (env.get('BLAME_MODEL_CATALOG_LIVE_REFRESH') === false) return staticCatalog
  try {
    const url = env.get('BLAME_MODELS_DEV_URL') ?? 'https://models.dev/api.json'
    const live = await fetchClineLiveProviderModels(
      url,
      staticCatalog.map((provider) => provider.id)
    )
    return staticCatalog.map((provider) => mergeLiveProvider(provider, live))
  } catch (error) {
    logger.warn({ err: error }, 'Unable to refresh the live Cline model catalog')
    return staticCatalog
  }
}

function mergeLiveProvider(
  provider: CatalogProvider,
  live: Record<string, Record<string, ModelInfo>>
) {
  const liveModels = live[provider.id] ?? {}
  const allowedModels = authoritativeProviderIds.has(provider.id)
    ? Object.fromEntries(
        Object.keys(provider.models)
          .filter((modelId) => modelId in liveModels)
          .map((modelId) => [modelId, liveModels[modelId]])
      )
    : liveModels
  const normalized = Object.fromEntries(
    Object.entries(allowedModels).map(([modelId, model]) => [modelId, catalogModel(modelId, model)])
  )
  return { ...provider, models: { ...provider.models, ...normalized } }
}

async function loadOpenRouterModels() {
  const apiKey = env.get('OPENROUTER_API_KEY')?.release().trim()
  if (!apiKey) return []
  try {
    return await fetchOpenRouterCatalog(apiKey)
  } catch (error) {
    logger.warn({ err: error }, 'Unable to refresh OpenRouter model metadata')
    return []
  }
}

function enrichProviders(
  providers: CatalogProvider[],
  openRouterModels: OpenRouterModel[],
  previous: ModelCatalogSnapshot | null
) {
  if (!openRouterModels.length) return preserveEnrichment(providers, previous)
  const matcher = new ModelCatalogMatcher(openRouterModels)
  return providers.map((provider) => ({
    ...provider,
    models: Object.fromEntries(
      Object.entries(provider.models).map(([id, model]) => [
        id,
        enrichModel(provider.id, model, matcher),
      ])
    ),
  }))
}

function enrichModel(providerId: string, model: CatalogModel, matcher: ModelCatalogMatcher) {
  const match = matcher.match(providerId, model)
  if (!match) return model
  return {
    ...model,
    contextWindow: model.contextWindow ?? match.model.contextWindow,
    maxTokens: model.maxTokens ?? match.model.maxTokens,
    releaseDate: model.releaseDate ?? match.model.releaseDate,
    canonicalModelId: match.model.canonicalSlug,
    matchConfidence: match.confidence,
    benchmark: match.model.benchmark,
    cost: mergedCost(model, match.model),
  }
}

function mergedCost(model: CatalogModel, openRouter: OpenRouterModel) {
  return {
    input: preferredPrice(model.cost.input, openRouter.inputPrice),
    output: preferredPrice(model.cost.output, openRouter.outputPrice),
    cacheRead: preferredPrice(model.cost.cacheRead, openRouter.cacheReadPrice),
    cacheWrite: preferredPrice(model.cost.cacheWrite, openRouter.cacheWritePrice),
  }
}

function preferredPrice(providerPrice: number | null, openRouterPrice: number | null) {
  if (providerPrice !== null && providerPrice > 0) return providerPrice
  return openRouterPrice ?? providerPrice
}

function preserveEnrichment(providers: CatalogProvider[], previous: ModelCatalogSnapshot | null) {
  if (!previous) return providers
  const previousProviders = parseSnapshot(previous).providers
  const previousModels = new Map(
    previousProviders.flatMap((provider) =>
      Object.values(provider.models).map((model) => [`${provider.id}:${model.id}`, model] as const)
    )
  )
  return providers.map((provider) => ({
    ...provider,
    models: Object.fromEntries(
      Object.entries(provider.models).map(([id, model]) => [
        id,
        mergePreviousModel(model, previousModels.get(`${provider.id}:${model.id}`)),
      ])
    ),
  }))
}

function mergePreviousModel(model: CatalogModel, previous?: CatalogModel) {
  if (!previous) return model
  return {
    ...model,
    canonicalModelId: previous.canonicalModelId,
    matchConfidence: previous.matchConfidence,
    benchmark: previous.benchmark,
    cost: {
      input: model.cost.input ?? previous.cost.input,
      output: model.cost.output ?? previous.cost.output,
      cacheRead: model.cost.cacheRead ?? previous.cost.cacheRead,
      cacheWrite: model.cost.cacheWrite ?? previous.cost.cacheWrite,
    },
  }
}

function addCredentialModels(
  providers: CatalogProvider[],
  credentials: ProviderCredential[],
  openRouterModels: OpenRouterModel[]
) {
  const customIds = credentials
    .filter((credential) => credential.providerId === 'openai-compatible')
    .flatMap(credentialModelIds)
  if (!customIds.length) return providers
  const matcher = new ModelCatalogMatcher(openRouterModels)
  return providers.map((provider) =>
    provider.id === 'openai-compatible' ? withCustomModels(provider, customIds, matcher) : provider
  )
}

function withCustomModels(
  provider: CatalogProvider,
  modelIds: string[],
  matcher: ModelCatalogMatcher
) {
  const fallback = provider.models.custom ?? Object.values(provider.models)[0]
  const models = Object.fromEntries(
    Array.from(new Set(modelIds)).map((id) => [id, customModel(id, fallback, matcher)])
  )
  return { ...provider, models: { ...provider.models, ...models } }
}

function customModel(id: string, fallback: CatalogModel | undefined, matcher: ModelCatalogMatcher) {
  const model = {
    ...(fallback ?? { cost: emptyCost() }),
    contextWindow: undefined,
    cost: emptyCost(),
    id,
    maxTokens: undefined,
    name: id,
    releaseDate: undefined,
    canonicalModelId: undefined,
    benchmark: undefined,
  }
  return enrichModel('openai-compatible', model, matcher)
}

function emptyCost() {
  return { input: null, output: null, cacheRead: null, cacheWrite: null }
}

function parseSnapshot(snapshot: ModelCatalogSnapshot): CatalogSnapshotPayload {
  const value = JSON.parse(snapshot.payload) as CatalogSnapshotPayload
  if (!Array.isArray(value.providers) || typeof value.generatedAt !== 'string') {
    throw new Error('Invalid model catalog snapshot')
  }
  return value
}

function providerDefaults(providers: CatalogProvider[]) {
  return Object.fromEntries(
    providers.map((provider) => [
      provider.id,
      provider.defaultModelId ?? Object.keys(provider.models)[0] ?? '',
    ])
  )
}

function hashCatalog(providers: CatalogProvider[]) {
  return createHash('sha256')
    .update(JSON.stringify({ catalogPolicyVersion, providers }))
    .digest('hex')
}

function snapshotStale(snapshot: ModelCatalogSnapshot) {
  const refreshHours = env.get('BLAME_MODEL_CATALOG_REFRESH_HOURS') ?? 6
  return snapshot.refreshedAt < DateTime.utc().minus({ hours: refreshHours })
}

function triggerRefresh(
  staticCatalog: CatalogProvider[],
  catalogHash: string,
  previous: ModelCatalogSnapshot
) {
  void refreshCatalog(staticCatalog, catalogHash, previous).catch((error) => {
    logger.error({ err: error }, 'Unable to persist the refreshed model catalog')
  })
}
