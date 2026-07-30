import {
  fetchLiveProviderModels,
  getAllProviders,
  getModelsForProvider,
  resolveProviderModelCatalogKeys,
  type ModelInfo,
  type ProviderInfo,
} from '@cline/llms'
import { parentPort, workerData } from 'node:worker_threads'
import type { ClineProviderCatalog } from './cline_catalog_client.js'

type ClineCatalogRequest =
  | { kind: 'catalog' }
  | { kind: 'live'; url: string; providerIds: string[] }

async function loadProviderCatalog() {
  const providers = await getAllProviders()
  return Promise.all(
    providers.map(async (provider: ProviderInfo) => ({
      authoritativeModels: provider.metadata?.usageCostDisplay === 'subscription',
      provider,
      models: await getModelsForProvider(provider.id),
    }))
  ) satisfies Promise<ClineProviderCatalog[]>
}

async function loadLiveCatalog(url: string, providerIds: string[]) {
  const catalog = await fetchLiveProviderModels(url)
  return Object.fromEntries(
    providerIds.map((providerId) => [providerId, providerLiveModels(providerId, catalog)])
  )
}

function providerLiveModels(
  providerId: string,
  catalog: Record<string, Record<string, ModelInfo>>
) {
  return Object.assign(
    {},
    ...resolveProviderModelCatalogKeys(providerId).map((key: string) => catalog[key] ?? {})
  )
}

function executeRequest(request: ClineCatalogRequest) {
  if (request.kind === 'live') return loadLiveCatalog(request.url, request.providerIds)
  return loadProviderCatalog()
}

async function postResult() {
  try {
    const value = await executeRequest(workerData as ClineCatalogRequest)
    parentPort?.postMessage({ ok: true, value })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    parentPort?.postMessage({ ok: false, message })
  }
}

await postResult()
