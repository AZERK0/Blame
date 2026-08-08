import { previewRuntimeConfig, type PreviewRuntimeConfig } from '#config/preview_runtime'
import PreviewProjectBaseline, {
  type PreviewProjectBaselineStatus,
} from '#models/preview_project_baseline'
import PreviewSession from '#models/preview_session'
import UserStory from '#models/user_story'
import {
  previewBaselineFingerprint,
  sanitizedFingerprintPart,
} from '#services/preview_baselines/baseline_fingerprint'
import type { PreviewBaselineProvider } from '#services/preview_baselines/preview_baseline_provider'
import VercelSandboxBaselineProvider from '#services/preview_baselines/vercel_sandbox_baseline_provider'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { createHash } from 'node:crypto'
import type { PreviewExecutionPlan, SourceArtifact } from '@blame/preview-runtime'
import {
  ATTR_BLAME_OPERATION_STATUS,
  ATTR_BLAME_RUNTIME_NAME,
  ATTR_BLAME_RUNTIME_PHASE,
  getBlameTelemetry,
} from '@blame/telemetry'

export type PreviewBaselineSourceMetadata = {
  baseRevision: string
  sanitizedTreeHash: string
  lockfileHash: string
  workspaceHash?: string
}

export type PreviewBaselineLookup = {
  id: string
  fingerprint: string
  status: PreviewProjectBaselineStatus
  baseRevision: string
  providerSnapshotId?: string
  sourceRevision?: string
  sanitizedTreeHash?: string
  lockfileHash?: string
}

type EnsureInput = {
  sessionId: string
  source: SourceArtifact
  sourceMetadata: PreviewBaselineSourceMetadata
}

const inFlight = new Map<string, Promise<PreviewProjectBaseline | undefined>>()
const telemetry = getBlameTelemetry()

export default class PreviewProjectBaselineService {
  constructor(
    private readonly config: PreviewRuntimeConfig = previewRuntimeConfig(),
    private readonly provider: PreviewBaselineProvider = new VercelSandboxBaselineProvider(config)
  ) {}

  async lookupForSession(sessionId: string, metadata: PreviewBaselineSourceMetadata) {
    return measureBaselinePhase('baseline.lookup', async () => {
      if (!this.config.baselines.enabled) return undefined
      const context = await sessionContext(sessionId)
      let identity: ReturnType<PreviewProjectBaselineService['identity']>
      try {
        identity = this.identity(context.projectId, context.planHash, metadata)
      } catch {
        return undefined
      }
      const ready = await this.ready(identity.fingerprint)
      if (!ready) return undefined
      await ready.merge({ lastUsedAt: DateTime.utc() }).save()
      return publicBaseline(ready)
    })
  }

  async ensure(input: EnsureInput) {
    if (!this.config.baselines.enabled) return undefined
    const context = await sessionContext(input.sessionId)
    let identity: ReturnType<PreviewProjectBaselineService['identity']>
    try {
      identity = this.identity(context.projectId, context.planHash, input.sourceMetadata)
    } catch {
      return undefined
    }
    const existing = await this.ready(identity.fingerprint)
    if (existing) {
      await existing.merge({ lastUsedAt: DateTime.utc() }).save()
      return publicBaseline(existing)
    }

    const active = inFlight.get(identity.fingerprint)
    if (active) return publicBaseline(await active)
    const build = this.ensureExclusive(identity.fingerprint, async () => {
      const current = await this.ready(identity.fingerprint)
      if (current) return current
      const row = await this.reserve(identity)
      if (row.status === 'ready') return row
      try {
        const receipt = await measureBaselinePhase('baseline.build', () =>
          this.provider.build({
            fingerprint: identity.fingerprint,
            source: { ...input.source, mode: 'baseline' },
            plan: context.plan,
            projectId: context.projectId,
            baseRevision: input.sourceMetadata.baseRevision,
          })
        )
        row.merge({
          status: 'ready',
          provider: receipt.provider,
          providerSnapshotId: receipt.providerSnapshotId,
          ownerSandboxName: receipt.ownerSandboxName ?? null,
          snapshotBytes: receipt.snapshotBytes ?? null,
          error: null,
          lastUsedAt: DateTime.utc(),
          expiresAt: DateTime.utc().plus({ days: this.config.baselines.retentionDays }),
        })
        await row.save()
        return row
      } catch (error) {
        row.merge({ status: 'failed', error: cleanBaselineError(error) })
        await row.save()
        return undefined
      }
    })
    inFlight.set(identity.fingerprint, build)
    try {
      return publicBaseline(await build)
    } finally {
      if (inFlight.get(identity.fingerprint) === build) inFlight.delete(identity.fingerprint)
    }
  }

  async gc(limit = 25) {
    return measureBaselinePhase('baseline.gc', async () => {
      if (!this.config.baselines.enabled) return { deleted: 0, failed: 0 }
      const referenced = PreviewSession.query()
        .select('baselineId')
        .whereNotNull('baselineId')
        .whereRaw("JSON_UNQUOTE(JSON_EXTRACT(state, '$.host')) <> 'destroyed'")
      const expiredRows = await PreviewProjectBaseline.query()
        .whereNotIn('status', ['deleting'])
        .where((query) => {
          query.where('status', 'failed').orWhere((expired) => {
            expired
              .where('status', 'ready')
              .whereNotNull('expiresAt')
              .where('expiresAt', '<=', DateTime.utc().toJSDate())
          })
        })
        .whereNotIn('id', referenced)
        .orderBy('createdAt', 'asc')
        .limit(limit)
      const freshRows = await PreviewProjectBaseline.query()
        .where('status', 'ready')
        .where((query) =>
          query.whereNull('expiresAt').orWhere('expiresAt', '>', DateTime.utc().toJSDate())
        )
        .whereNotIn('id', referenced)
        .orderBy('lastUsedAt', 'desc')
        .offset(this.config.baselines.maxUnreferenced)
        .limit(limit)
      const rows = [...new Map([...expiredRows, ...freshRows].map((row) => [row.id, row])).values()]
      let deleted = 0
      let failed = 0
      for (const row of rows) {
        row.status = 'deleting'
        await row.save()
        try {
          if (row.providerSnapshotId) {
            await measureBaselinePhase('baseline.delete', () =>
              this.provider.delete({
                providerSnapshotId: row.providerSnapshotId!,
                ownerSandboxName: row.ownerSandboxName,
              })
            )
          }
          await row.delete()
          deleted += 1
        } catch {
          row.status = 'expired'
          await row.save()
          failed += 1
        }
      }
      return { deleted, failed }
    })
  }

  async getReady(id: string, sessionId: string, metadata?: PreviewBaselineSourceMetadata) {
    const session = await PreviewSession.findOrFail(sessionId)
    const story = await UserStory.findOrFail(session.userStoryId)
    const row = await PreviewProjectBaseline.query()
      .where('id', id)
      .where('projectId', story.projectId)
      .where('status', 'ready')
      .first()
    if (
      !row ||
      (row.expiresAt && row.expiresAt <= DateTime.utc()) ||
      (metadata &&
        (row.baseRevision !== metadata.baseRevision ||
          row.sanitizedTreeHash !== metadata.sanitizedTreeHash ||
          row.lockfileHash !== metadata.lockfileHash))
    )
      return undefined
    await row.merge({ lastUsedAt: DateTime.utc() }).save()
    return publicBaseline(row)
  }

  private identity(projectId: string, planHash: string, metadata: PreviewBaselineSourceMetadata) {
    const baseRevision = sanitizedFingerprintPart(metadata.baseRevision, 'baseRevision')
    const sanitizedTreeHash = sanitizedFingerprintPart(
      metadata.sanitizedTreeHash,
      'sanitizedTreeHash'
    )
    const lockfileHash = sanitizedFingerprintPart(metadata.lockfileHash, 'lockfileHash')
    const runnerImageDigest = this.config.sandbox.image?.split('@').at(-1)
    if (
      !this.config.sandbox.image ||
      !runnerImageDigest ||
      !/^sha256:[a-f0-9]{64}$/i.test(runnerImageDigest)
    ) {
      throw new Error('A digest-pinned runner image is required for preview baselines.')
    }
    const fingerprint = previewBaselineFingerprint({
      projectId,
      baseRevision,
      sanitizedTreeHash,
      planHash,
      lockfileHash,
      runnerImageDigest,
      runnerVersion: this.config.sandbox.runnerVersion,
      protocolVersion: this.config.sandbox.protocolVersion,
      cachePolicyVersion: this.config.baselines.cachePolicyVersion,
    })
    return {
      fingerprint,
      projectId,
      baseRevision,
      sanitizedTreeHash,
      planHash,
      lockfileHash,
      runnerImageDigest,
      runnerVersion: this.config.sandbox.runnerVersion,
      protocolVersion: this.config.sandbox.protocolVersion,
    }
  }

  private async ensureExclusive(
    fingerprint: string,
    operation: () => Promise<PreviewProjectBaseline | undefined>
  ) {
    const knex = db.connection().getWriteClient()
    const connection = await knex.client.acquireConnection()
    const lockName =
      `blame-baseline:${createHash('sha256').update(fingerprint).digest('hex')}`.slice(0, 64)
    try {
      const result = await knex
        .raw('SELECT GET_LOCK(?, ?) AS acquired', [lockName, this.config.baselines.waitSeconds])
        .connection(connection)
      if (!mysqlBoolean(result, 'acquired')) return undefined
      try {
        const slot =
          createHash('sha256').update(fingerprint).digest().readUInt32BE(0) %
          this.config.baselines.maxBuilders
        const builderLockName = `blame-baseline-builder:${slot}`.slice(0, 64)
        const builder = await knex
          .raw('SELECT GET_LOCK(?, ?) AS acquired', [
            builderLockName,
            this.config.baselines.waitSeconds,
          ])
          .connection(connection)
        if (!mysqlBoolean(builder, 'acquired')) return undefined
        try {
          return await operation()
        } finally {
          await knex
            .raw('SELECT RELEASE_LOCK(?) AS released', [builderLockName])
            .connection(connection)
        }
      } finally {
        await knex.raw('SELECT RELEASE_LOCK(?) AS released', [lockName]).connection(connection)
      }
    } finally {
      await knex.client.releaseConnection(connection)
    }
  }

  private async ready(fingerprint: string) {
    return PreviewProjectBaseline.query()
      .where('fingerprint', fingerprint)
      .where('status', 'ready')
      .where((query) =>
        query.whereNull('expiresAt').orWhere('expiresAt', '>', DateTime.utc().toJSDate())
      )
      .first()
  }

  private async reserve(identity: ReturnType<PreviewProjectBaselineService['identity']>) {
    const existing = await PreviewProjectBaseline.query()
      .where('fingerprint', identity.fingerprint)
      .first()
    if (existing?.status === 'building') return existing
    if (existing?.status === 'failed' || existing?.status === 'expired') {
      existing.merge({ status: 'building', error: null, expiresAt: null })
      await existing.save()
      return existing
    }
    if (existing) return existing
    return PreviewProjectBaseline.create({
      projectId: identity.projectId,
      fingerprint: identity.fingerprint,
      baseRevision: identity.baseRevision,
      sanitizedTreeHash: identity.sanitizedTreeHash,
      planHash: identity.planHash,
      lockfileHash: identity.lockfileHash,
      runnerVersion: identity.runnerVersion,
      protocolVersion: identity.protocolVersion,
      runnerImageDigest: identity.runnerImageDigest,
      provider: 'vercel-sandbox',
      status: 'building',
      error: null,
      providerSnapshotId: null,
      ownerSandboxName: null,
      snapshotBytes: null,
      lastUsedAt: null,
      expiresAt: null,
    })
  }
}

async function sessionContext(sessionId: string) {
  const session = await PreviewSession.findOrFail(sessionId)
  const story = await UserStory.findOrFail(session.userStoryId)
  return {
    projectId: story.projectId,
    planHash: session.planHash,
    plan: JSON.parse(session.plan) as PreviewExecutionPlan,
  }
}

function publicBaseline(
  row: PreviewProjectBaseline | undefined
): PreviewBaselineLookup | undefined {
  if (!row) return undefined
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    status: row.status,
    baseRevision: row.baseRevision,
    providerSnapshotId: row.providerSnapshotId ?? undefined,
  }
}

function cleanBaselineError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Baseline build failed.'
  return message
    .replace(/https?:\/\/[^\s"']+/gi, '[redacted-url]')
    .replace(/\b(token|secret|password|credential|signature)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, 500)
}

function mysqlBoolean(result: unknown, key: string) {
  if (!Array.isArray(result) || !Array.isArray(result[0])) return false
  const row = result[0][0]
  return Boolean(
    row && typeof row === 'object' && Number((row as Record<string, unknown>)[key]) === 1
  )
}

async function measureBaselinePhase<T>(phase: string, operation: () => Promise<T>) {
  const startedAt = performance.now()
  let outcome: 'succeeded' | 'failed' = 'succeeded'
  try {
    return await operation()
  } catch (error) {
    outcome = 'failed'
    throw error
  } finally {
    const attributes = {
      [ATTR_BLAME_RUNTIME_NAME]: 'vercel-compose',
      [ATTR_BLAME_RUNTIME_PHASE]: phase,
      [ATTR_BLAME_OPERATION_STATUS]: outcome,
    }
    telemetry.count('blame.runtime.phase.count', 1, attributes)
    telemetry.record(
      'blame.runtime.phase.duration',
      Math.max(0, performance.now() - startedAt) / 1_000,
      attributes
    )
  }
}
