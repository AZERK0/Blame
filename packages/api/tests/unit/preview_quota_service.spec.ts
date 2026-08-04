import PreviewSession from '#models/preview_session'
import PreviewUsageSample from '#models/preview_usage_sample'
import PreviewQuotaService from '#services/preview_sessions/preview_quota_service'
import type { PreviewRuntimeConfig } from '#config/preview_runtime'
import { test } from '@japa/runner'

test.group('preview quota service', () => {
  test('uses physical database names for aggregate columns', async ({ assert, cleanup }) => {
    const sums: string[] = []
    const sessionQuery = PreviewSession.query
    const usageQuery = PreviewUsageSample.query
    const query = aggregateQuery(sums)
    Object.defineProperty(PreviewSession, 'query', { configurable: true, value: () => query })
    Object.defineProperty(PreviewUsageSample, 'query', { configurable: true, value: () => query })
    cleanup(() => {
      Object.defineProperty(PreviewSession, 'query', { configurable: true, value: sessionQuery })
      Object.defineProperty(PreviewUsageSample, 'query', { configurable: true, value: usageQuery })
    })

    await new PreviewQuotaService(enabledConfig()).assertCanCreate('user-1', 1)

    assert.deepEqual(sums, [
      'resource_vcpus as total',
      'estimated_cost_usd as total',
      'estimated_cost_usd as total',
    ])
  })

  test('counts only non-suspended sessions with an allocated provider host', async ({
    assert,
    cleanup,
  }) => {
    const notNullColumns: string[] = []
    const rawPredicates: string[] = []
    const sessionQuery = PreviewSession.query
    const usageQuery = PreviewUsageSample.query
    const query = aggregateQuery([], { notNullColumns, rawPredicates })
    Object.defineProperty(PreviewSession, 'query', { configurable: true, value: () => query })
    Object.defineProperty(PreviewUsageSample, 'query', { configurable: true, value: () => query })
    cleanup(() => {
      Object.defineProperty(PreviewSession, 'query', { configurable: true, value: sessionQuery })
      Object.defineProperty(PreviewUsageSample, 'query', { configurable: true, value: usageQuery })
    })

    await new PreviewQuotaService(enabledConfig()).assertCanCreate('user-1', 1)

    assert.deepEqual(notNullColumns, ['providerHandleEncrypted', 'providerHandleEncrypted'])
    assert.deepEqual(rawPredicates, [
      "JSON_UNQUOTE(JSON_EXTRACT(state, '$.host')) NOT IN ('destroyed', 'suspended')",
      "JSON_UNQUOTE(JSON_EXTRACT(state, '$.host')) NOT IN ('destroyed', 'suspended')",
    ])
  })
})

function aggregateQuery(
  sums: string[],
  filters: { notNullColumns?: string[]; rawPredicates?: string[] } = {}
) {
  const query = {
    count: () => Promise.resolve([{ total: 0 }]),
    select: () => query,
    sum: (column: string) => {
      sums.push(column)
      return Promise.resolve([{ total: 0 }])
    },
    where: () => query,
    whereIn: () => query,
    whereNotNull: (column: string) => {
      filters.notNullColumns?.push(column)
      return query
    },
    whereRaw: (predicate: string) => {
      filters.rawPredicates?.push(predicate)
      return query
    },
  }
  return query
}

function enabledConfig() {
  return {
    enabled: true,
    disabledTenantIds: new Set<string>(),
    maxActivePerUser: 5,
    maxConcurrentVcpusPerUser: 10,
    maxCreationsPerMinute: 5,
    maxCreationsPerDay: 30,
    maxCreationsPerMonth: 400,
    monthlyBudgetUsd: 20,
    globalMonthlyBudgetUsd: 25,
  } as PreviewRuntimeConfig
}
