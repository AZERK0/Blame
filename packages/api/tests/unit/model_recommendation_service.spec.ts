import type {
  CatalogModel,
  CatalogProvider,
  ModelRecommendationProfile,
} from '#services/model_catalog_contract'
import { buildModelRecommendations } from '#services/model_recommendation_service'
import { test } from '@japa/runner'

const profile: ModelRecommendationProfile = {
  inputTokens: 1_000_000,
  outputTokens: 0,
  cacheReadTokens: 0,
  sampleCount: 1,
}

test.group('model recommendation service', () => {
  test('keeps the benchmarked price and intelligence Pareto frontier', ({ assert }) => {
    const provider = catalogProvider('openai', [
      model('cheap', 1, 40),
      model('balanced', 3, 70),
      model('dominated', 4, 60),
      model('smart', 8, 90),
    ])

    const recommendations = buildModelRecommendations(
      [provider],
      [provider.id],
      profile,
      '2026-07-30T00:00:00.000Z'
    )

    assert.deepEqual(
      recommendations.all.map((entry) => entry.modelId),
      ['cheap', 'balanced', 'smart']
    )
    assert.isTrue(recommendations.all.every((entry) => entry.position <= 0.74))
  })

  test('puts recent unbenchmarked models in the final segment sorted by price', ({ assert }) => {
    const provider = catalogProvider('anthropic', [
      model('rated', 2, 50),
      model('new-expensive', 9, undefined, '2026-07-30'),
      model('old-unrated', 1, undefined, '2025-06-01'),
      model('unknown-release', 1),
      model('new-cheap-old', 3, undefined, '2026-06-01'),
      model('new-cheap-recent', 3, undefined, '2026-07-29'),
    ])

    const recommendations = buildModelRecommendations(
      [provider],
      [provider.id],
      profile,
      '2026-07-30T00:00:00.000Z'
    )
    const unbenchmarked = recommendations.all.filter((entry) => entry.segment === 'unbenchmarked')

    assert.deepEqual(
      unbenchmarked.map((entry) => entry.modelId),
      ['new-cheap-recent', 'new-cheap-old', 'new-expensive']
    )
    assert.isTrue(unbenchmarked.every((entry) => entry.position >= 0.8))
  })

  test('deduplicates canonical models across providers using estimated task cost', ({ assert }) => {
    const direct = catalogProvider('openai', [model('gpt-direct', 4, 80, undefined, 'openai/gpt')])
    const routed = catalogProvider('openrouter', [
      model('openai/gpt', 3, 80, undefined, 'openai/gpt'),
    ])

    const recommendations = buildModelRecommendations(
      [direct, routed],
      [direct.id, routed.id],
      profile,
      '2026-07-30T00:00:00.000Z'
    )

    assert.lengthOf(recommendations.all, 1)
    assert.equal(recommendations.all[0].providerId, 'openrouter')
    assert.lengthOf(recommendations.byProvider.openai, 1)
    assert.lengthOf(recommendations.byProvider.openrouter, 1)
  })
})

function catalogProvider(id: string, models: CatalogModel[]): CatalogProvider {
  return {
    id,
    name: id,
    models: Object.fromEntries(models.map((entry) => [entry.id, entry])),
  }
}

function model(
  id: string,
  inputPrice: number,
  smartScore?: number,
  releaseDate?: string,
  canonicalModelId?: string
): CatalogModel {
  return {
    id,
    name: id,
    releaseDate,
    canonicalModelId,
    benchmark: smartScore === undefined ? undefined : { smartScore },
    cost: {
      input: inputPrice,
      output: null,
      cacheRead: null,
      cacheWrite: null,
    },
  }
}
