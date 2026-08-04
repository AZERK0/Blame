import { previewRuntimeConfig, type PreviewRuntimeConfig } from '#config/preview_runtime'
import PreviewSession from '#models/preview_session'
import PreviewUsageSample from '#models/preview_usage_sample'
import db from '@adonisjs/lucid/services/db'
import { PreviewRuntimeError } from '@blame/preview-runtime'
import { DateTime } from 'luxon'

export default class PreviewQuotaService {
  constructor(private readonly config: PreviewRuntimeConfig = previewRuntimeConfig()) {}

  async withCreationLock<T>(ownerUserId: string, operation: () => Promise<T>) {
    const knex = db.connection().getWriteClient()
    const connection = await knex.client.acquireConnection()
    const lockName = `blame-preview-quota:${ownerUserId}`.slice(0, 64)
    try {
      const result = await knex
        .raw('SELECT GET_LOCK(?, 15) AS acquired', [lockName])
        .connection(connection)
      if (!mysqlBoolean(result, 'acquired')) throw new Error('Preview quota lock timed out.')
      try {
        return await operation()
      } finally {
        await knex.raw('SELECT RELEASE_LOCK(?) AS released', [lockName]).connection(connection)
      }
    } finally {
      await knex.client.releaseConnection(connection)
    }
  }

  assertRuntimeEnabled(ownerUserId: string) {
    if (!this.config.enabled || this.config.disabledTenantIds.has(ownerUserId)) {
      throw new PreviewRuntimeError({
        code: 'PREVIEW_ACCESS_DENIED',
        message: 'Managed cloud previews are disabled.',
        retryable: false,
      })
    }
  }

  async assertCanCreate(ownerUserId: string, requestedVcpus: number) {
    this.assertRuntimeEnabled(ownerUserId)
    const now = DateTime.utc()
    // A provider handle is the durable signal that Vercel allocated a sandbox. Failed or
    // unprovisioned records without one must not consume active-session or concurrent-vCPU quota.
    const [active, activeVcpus, createdMinute, createdToday, createdMonth] = await Promise.all([
      PreviewSession.query()
        .where('ownerUserId', ownerUserId)
        .whereNotNull('providerHandleEncrypted')
        .whereRaw("JSON_UNQUOTE(JSON_EXTRACT(state, '$.host')) NOT IN ('destroyed', 'suspended')")
        .count('* as total'),
      PreviewSession.query()
        .where('ownerUserId', ownerUserId)
        .whereNotNull('providerHandleEncrypted')
        .whereRaw("JSON_UNQUOTE(JSON_EXTRACT(state, '$.host')) NOT IN ('destroyed', 'suspended')")
        .sum('resource_vcpus as total'),
      PreviewSession.query()
        .where('ownerUserId', ownerUserId)
        .where('createdAt', '>=', now.minus({ minutes: 1 }).toSQL())
        .count('* as total'),
      PreviewSession.query()
        .where('ownerUserId', ownerUserId)
        .where('createdAt', '>=', now.startOf('day').toSQL())
        .count('* as total'),
      PreviewSession.query()
        .where('ownerUserId', ownerUserId)
        .where('createdAt', '>=', now.startOf('month').toSQL())
        .count('* as total'),
    ])
    if (countValue(active) >= this.config.maxActivePerUser) {
      throw quotaFailure('The active cloud preview quota has been reached.')
    }
    if (countValue(createdToday) >= this.config.maxCreationsPerDay) {
      throw quotaFailure('The daily cloud preview creation quota has been reached.')
    }
    if (countValue(createdMinute) >= this.config.maxCreationsPerMinute) {
      throw quotaFailure('The cloud preview creation rate limit has been reached.')
    }
    if (countValue(createdMonth) >= this.config.maxCreationsPerMonth) {
      throw quotaFailure('The monthly cloud preview creation quota has been reached.')
    }
    if (numericAggregate(activeVcpus) + requestedVcpus > this.config.maxConcurrentVcpusPerUser) {
      throw quotaFailure('The concurrent cloud preview vCPU quota has been reached.')
    }
    await this.assertBudget(ownerUserId)
  }

  async assertBudget(ownerUserId: string) {
    const start = DateTime.utc().startOf('month').toSQL()
    const [tenantUsage, globalUsage] = await Promise.all([
      PreviewUsageSample.query()
        .whereIn('sessionId', PreviewSession.query().select('id').where('ownerUserId', ownerUserId))
        .where('observedAt', '>=', start)
        .sum('estimated_cost_usd as total'),
      PreviewUsageSample.query()
        .where('observedAt', '>=', start)
        .sum('estimated_cost_usd as total'),
    ])
    if (numericAggregate(tenantUsage) >= this.config.monthlyBudgetUsd) {
      throw new PreviewRuntimeError({
        code: 'BUDGET_EXCEEDED',
        message: 'The monthly cloud preview budget has been reached.',
        retryable: false,
      })
    }
    if (numericAggregate(globalUsage) >= this.config.globalMonthlyBudgetUsd) {
      throw new PreviewRuntimeError({
        code: 'BUDGET_EXCEEDED',
        message: 'The global managed preview budget has been reached.',
        retryable: false,
      })
    }
  }
}

function quotaFailure(message: string) {
  return new PreviewRuntimeError({ code: 'PROVIDER_QUOTA', message, retryable: false })
}

function countValue(rows: unknown[]) {
  return numericAggregate(rows)
}

function numericAggregate(rows: unknown[]) {
  const row = rows[0] as { $extras?: Record<string, unknown>; total?: unknown } | undefined
  const value = Number(row?.$extras?.total ?? row?.total ?? 0)
  return Number.isFinite(value) ? value : 0
}

function mysqlBoolean(result: unknown, key: string) {
  if (!Array.isArray(result) || !Array.isArray(result[0])) return false
  const row = result[0][0]
  return Boolean(
    row && typeof row === 'object' && Number((row as Record<string, unknown>)[key]) === 1
  )
}
