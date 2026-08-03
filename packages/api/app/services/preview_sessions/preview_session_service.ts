import UserStoriesService from '#services/user_stories_service'
import PreviewSessionRepository from '#services/preview_sessions/preview_session_repository'
import {
  cumulativePeakDelta,
  summarizeCumulativeUsage,
} from '#services/preview_sessions/preview_usage_accounting'
import PreviewDistributedLock from '#services/preview_sessions/preview_distributed_lock'
import DatabasePreviewEventSink from '#services/preview_sessions/preview_event_sink'
import PreviewQuotaService from '#services/preview_sessions/preview_quota_service'
import PreviewLeaseService from '#services/preview_sessions/preview_lease_service'
import PreviewAccessTicketService from '#services/preview_gateway/preview_access_ticket_service'
import VercelSandboxDriver from '#services/sandboxes/vercel_sandbox_driver'
import PreviewSession from '#models/preview_session'
import PreviewUsageSample from '#models/preview_usage_sample'
import WorkspaceArtifactService from '#services/workspace_artifacts/workspace_artifact_service'
import PreviewEdgeRouteService from '#services/preview_gateway/preview_edge_route_service'
import PreviewCapabilityService from '#services/preview_gateway/preview_capability_service'
import { previewRuntimeConfig } from '#config/preview_runtime'
import { DateTime } from 'luxon'
import { createHash } from 'node:crypto'
import {
  fenceRuntimeHandle,
  PreviewOrchestrator,
  PreviewReconciler,
  PreviewRuntimeError,
  compilePreviewManifest,
  type PreviewRuntimeDriver,
  type PreviewSessionCommand,
  type RuntimeProfileId,
} from '@blame/preview-runtime'
import type { PreviewManifest } from '@blame/preview-contract'

export type CreateManagedPreviewInput = {
  userStoryId: string
  profile: Exclude<RuntimeProfileId, 'local-container'>
  previewManifest: PreviewManifest
  cloudUploadConsentAt: string
  sourceRevision?: string
  resourceSize?: { vcpus: number; memoryGb: number }
}

export type PreviewSessionServiceDependencies = {
  repository?: PreviewSessionRepository
  lock?: PreviewDistributedLock
  eventSink?: DatabasePreviewEventSink
  quota?: PreviewQuotaService
  lease?: PreviewLeaseService
  tickets?: PreviewAccessTicketService
  drivers?: PreviewRuntimeDriver[]
}

export default class PreviewSessionService {
  private readonly repository: PreviewSessionRepository
  private readonly lock: PreviewDistributedLock
  private readonly eventSink: DatabasePreviewEventSink
  private readonly quota: PreviewQuotaService
  private readonly lease: PreviewLeaseService
  private readonly tickets: PreviewAccessTicketService
  private readonly artifacts: WorkspaceArtifactService
  private readonly edgeRoutes = new PreviewEdgeRouteService()
  private readonly capabilities = new PreviewCapabilityService()
  private readonly drivers: Map<string, PreviewRuntimeDriver>
  private readonly orchestrator: PreviewOrchestrator

  constructor(dependencies: PreviewSessionServiceDependencies = {}) {
    this.repository = dependencies.repository ?? new PreviewSessionRepository()
    this.lock = dependencies.lock ?? new PreviewDistributedLock()
    this.eventSink = dependencies.eventSink ?? new DatabasePreviewEventSink()
    this.quota = dependencies.quota ?? new PreviewQuotaService()
    this.lease = dependencies.lease ?? new PreviewLeaseService()
    this.tickets = dependencies.tickets ?? new PreviewAccessTicketService()
    this.artifacts = new WorkspaceArtifactService()
    const drivers = dependencies.drivers ?? [
      new VercelSandboxDriver('vercel-compose'),
      new VercelSandboxDriver('vercel-process'),
    ]
    this.drivers = new Map(drivers.map((driver) => [driver.profile, driver]))
    this.orchestrator = new PreviewOrchestrator(
      this.repository,
      this.lock,
      this.eventSink,
      new PreviewReconciler({
        repository: this.repository,
        eventSink: this.eventSink,
        drivers: this.drivers,
      })
    )
  }

  async create(ownerUserId: string, input: CreateManagedPreviewInput, operationId: string) {
    validateOperationId(operationId)
    await new UserStoriesService().find(ownerUserId, input.userStoryId)
    const consentAt = validRecentConsent(input.cloudUploadConsentAt)
    const plan = compilePreviewManifest(input.previewManifest)
    const planHash = stableHash(plan)
    const sessionId = idempotentSessionId(ownerUserId, operationId)
    return this.quota.withCreationLock(ownerUserId, async () => {
      const existing = await this.repository.get(sessionId)
      if (existing) {
        if (
          existing.ownerUserId !== ownerUserId ||
          existing.userStoryId !== input.userStoryId ||
          existing.profile !== input.profile ||
          existing.planHash !== planHash
        ) {
          throw new PreviewRuntimeError({
            code: 'INTERNAL',
            message: 'An idempotency key cannot be reused for another preview.',
            retryable: false,
          })
        }
        if (['failed', 'provisioning', 'resuming'].includes(existing.state.host)) {
          await this.orchestrator.command(
            sessionId,
            { type: 'resume-host' },
            `create-recovery:${stableHash(operationId).slice(0, 32)}`
          )
        }
        const recovered = await this.get(ownerUserId, sessionId)
        if (recovered.state.host === 'running') await this.lease.renew(sessionId, ownerUserId)
        return recovered
      }
      const requestedVcpus =
        input.resourceSize?.vcpus ?? (input.profile === 'vercel-process' ? 1 : 2)
      await this.quota.assertCanCreate(ownerUserId, requestedVcpus)
      const session = await this.orchestrator.create({
        id: sessionId,
        userStoryId: input.userStoryId,
        ownerUserId,
        profile: input.profile,
        plan,
        planHash,
        sourceRevision: input.sourceRevision,
        resourceSize: input.resourceSize,
        cloudUploadConsentAt: consentAt,
      })
      await this.lease.renew(session.id, ownerUserId)
      return this.get(ownerUserId, session.id)
    })
  }

  async get(ownerUserId: string, sessionId: string) {
    const session = await this.orchestrator.get(sessionId)
    assertOwner(session.ownerUserId, ownerUserId)
    const leaseExpiresAt =
      session.state.host === 'running' && session.desired.host === 'active'
        ? await this.lease.renew(sessionId, ownerUserId)
        : session.leaseExpiresAt
    return {
      ...session,
      leaseExpiresAt,
      usage: await this.usageSummary(sessionId, session.resourceSize.memoryGb),
    }
  }

  async command(
    ownerUserId: string,
    sessionId: string,
    command: PreviewSessionCommand,
    operationId: string
  ) {
    const before = await this.get(ownerUserId, sessionId)
    if (['start-services', 'start-agent', 'resume-host'].includes(command.type)) {
      this.quota.assertRuntimeEnabled(ownerUserId)
      await this.quota.assertBudget(ownerUserId)
    }
    validateOperationId(operationId)
    if (command.type === 'destroy-host' && command.discardPendingDelta) {
      if (before.pendingDeltaArtifactId) {
        await this.artifacts.discard(
          before.pendingDeltaArtifactId,
          ownerUserId,
          command.discardPendingDelta.confirmationId
        )
      } else if (before.state.sync !== 'discarded') {
        throw new Error('There is no pending delta to discard.')
      }
    }
    const session = await this.orchestrator.command(sessionId, command, operationId)
    if (command.type === 'ack-local-sync' && before.pendingDeltaArtifactId) {
      await this.artifacts.markApplied(before.pendingDeltaArtifactId, ownerUserId)
    }
    if (session.state.host === 'running') await this.lease.renew(sessionId, ownerUserId)
    else await this.lease.release(sessionId, ownerUserId)
    if (session.state.host === 'destroyed') {
      await this.tickets.revokeSession(sessionId)
      await this.artifacts.scheduleSessionDeletion(sessionId)
    }
    await this.sampleUsage(sessionId, session.profile)
    return this.get(ownerUserId, sessionId)
  }

  async issueAccessTicket(ownerUserId: string, sessionId: string, endpointId?: string) {
    this.quota.assertRuntimeEnabled(ownerUserId)
    const session = await this.get(ownerUserId, sessionId)
    if (session.state.preview !== 'ready' || !session.endpointMap) {
      throw new PreviewRuntimeError({
        code: 'ENDPOINT_NOT_LISTENING',
        message: 'The preview is not ready.',
        retryable: true,
      })
    }
    const selected = endpointId ?? session.endpointMap.primaryEndpointId
    if (!session.endpointMap.routes.some((route) => route.endpointId === selected)) {
      throw new PreviewRuntimeError({
        code: 'PREVIEW_ACCESS_DENIED',
        message: 'The preview endpoint does not belong to this session.',
        retryable: false,
      })
    }
    await this.lease.renew(sessionId, ownerUserId)
    return this.tickets.issue(sessionId, selected, ownerUserId)
  }

  async issueDesktopBridgeGrant(ownerUserId: string, sessionId: string) {
    this.quota.assertRuntimeEnabled(ownerUserId)
    const session = await this.get(ownerUserId, sessionId)
    if (session.state.preview !== 'ready' || !session.endpointMap) {
      throw new PreviewRuntimeError({
        code: 'ENDPOINT_NOT_LISTENING',
        message: 'The preview is not ready.',
        retryable: true,
      })
    }
    await this.lease.renew(sessionId, ownerUserId)
    const providerRoutes = await this.edgeRoutes.resolveForDesktop(sessionId, ownerUserId)
    const routeByEndpoint = new Map(providerRoutes.map((route) => [route.endpointId, route]))
    return {
      sessionId,
      endpointRevision: session.endpointMap.revision,
      integratedPreviewRequired: session.endpointMap.integratedPreviewRequired,
      primaryEndpointId: session.endpointMap.primaryEndpointId,
      routes: session.endpointMap.routes.map((logical) => {
        const provider = routeByEndpoint.get(logical.endpointId)
        if (!provider) throw new Error('Provider route is unavailable.')
        const capability = this.capabilities.issue(provider)
        return {
          endpointId: logical.endpointId,
          logicalHost: logical.logicalHost,
          logicalPort: logical.logicalPort,
          protocol: logical.protocol,
          providerUrl: provider.upstreamUrl,
          capability: capability.token,
          capabilityExpiresAt: new Date(capability.expiresAt * 1000).toISOString(),
        }
      }),
    }
  }

  async *events(ownerUserId: string, sessionId: string, cursor?: string) {
    await this.get(ownerUserId, sessionId)
    yield* this.orchestrator.events(sessionId, cursor)
  }

  async *logs(ownerUserId: string, sessionId: string, cursor?: string) {
    const session = await this.get(ownerUserId, sessionId)
    const handle = await this.repository.getRuntimeHandle(sessionId)
    const driver = this.drivers.get(session.profile)
    if (!handle || !driver) return
    yield* driver.logs({ handle, cursor })
  }

  prepareSourceUpload(
    ownerUserId: string,
    sessionId: string,
    input: { sha256: string; size: number; sourceRevision: string }
  ) {
    return this.artifacts.prepareSourceUpload({
      sessionId,
      ownerUserId,
      ...input,
    })
  }

  async importSource(ownerUserId: string, sessionId: string, artifactId: string) {
    await this.get(ownerUserId, sessionId)
    const source = await this.artifacts.completeSourceUpload(artifactId, ownerUserId)
    return this.lock.withLock(sessionId, async ({ fencingToken }) => {
      const record = await this.repository.get(sessionId)
      const handle = await this.fencedHandle(sessionId, fencingToken)
      const driver = record && this.drivers.get(record.profile)
      if (!record || !handle || !driver) throw new Error('Preview runtime is not provisioned.')
      if (record.sourceArtifactId === source.id && record.state.sync === 'clean') {
        return this.get(ownerUserId, sessionId)
      }
      const importing = structuredClone(record)
      importing.state.sync = 'importing'
      importing.revision += 1
      await this.repository.save(importing, record.revision)
      try {
        const receipt = await driver.syncIn(handle, source)
        const current = (await this.repository.get(sessionId))!
        current.state.sync = 'clean'
        current.sourceRevision = receipt.sourceRevision
        current.sourceArtifactId = source.id
        current.lastExportedJournalRevision = '0'
        current.lastAppliedLocalRevision = '0'
        current.lastAcknowledgedRemoteRevision = '0'
        current.revision += 1
        await this.repository.save(current, current.revision - 1)
        return this.get(ownerUserId, sessionId)
      } catch (error) {
        const current = await this.repository.get(sessionId)
        if (current) {
          current.state.sync = 'failed'
          current.revision += 1
          await this.repository.save(current, current.revision - 1)
        }
        throw error
      }
    })
  }

  async exportSourceDelta(ownerUserId: string, sessionId: string) {
    const session = await this.get(ownerUserId, sessionId)
    if (remoteWritersActive(session.state)) {
      throw new PreviewRuntimeError({
        code: 'SYNC_CONFLICT',
        message: 'Stop remote writers before applying a workspace delta locally.',
        retryable: true,
      })
    }
    return this.lock.withLock(sessionId, async ({ fencingToken }) => {
      const record = await this.repository.get(sessionId)
      const handle = await this.fencedHandle(sessionId, fencingToken)
      const driver = record && this.drivers.get(record.profile)
      if (!record || !handle || !driver) throw new Error('Preview runtime is not provisioned.')
      if (remoteWritersActive(record.state)) {
        throw new PreviewRuntimeError({
          code: 'SYNC_CONFLICT',
          message: 'Remote writers became active before local synchronization.',
          retryable: true,
        })
      }
      const observation = await driver.inspect(handle)
      if (observation.engine === 'running' || observation.services.some(({ running }) => running)) {
        throw new PreviewRuntimeError({
          code: 'SYNC_CONFLICT',
          message: 'The runtime still reports an active remote writer.',
          retryable: true,
        })
      }
      const revision = observation.journalRevision ?? record.lastExportedJournalRevision ?? '0'
      if (record.pendingDeltaArtifactId && record.lastExportedJournalRevision === revision) {
        return this.artifacts.download(record.pendingDeltaArtifactId, ownerUserId)
      }
      const receipt = await driver.exportDelta(handle, revision)
      record.lastExportedJournalRevision = receipt.revision
      record.pendingDeltaArtifactId = receipt.artifactId
      record.state.sync = 'pending_local_sync'
      record.revision += 1
      await this.repository.save(record, record.revision - 1)
      return this.artifacts.download(receipt.artifactId, ownerUserId)
    })
  }

  async reconcileExpired(limit = 50) {
    const now = DateTime.utc()
    const candidates = await this.repository.listReconcileCandidates(now.toISO()!, limit)
    const results: Array<{ id: string; status: 'suspended' | 'skipped' | 'failed' }> = []
    for (const session of candidates) {
      if (!session.idleDeadlineAt || DateTime.fromISO(session.idleDeadlineAt) > now) {
        results.push({ id: session.id, status: 'skipped' })
        continue
      }
      try {
        await this.orchestrator.command(
          session.id,
          { type: 'suspend-host' },
          `reaper:${session.revision}:${session.generation}`
        )
        await this.sampleUsage(session.id, session.profile)
        results.push({ id: session.id, status: 'suspended' })
      } catch {
        results.push({ id: session.id, status: 'failed' })
      }
    }
    await Promise.all([
      this.artifacts.cleanupExpired(limit * 5),
      this.tickets.cleanupExpired(limit * 10),
    ])
    try {
      await this.sweepProviderOrphans()
    } catch {
      results.push({ id: 'provider-orphan-sweep', status: 'failed' })
    }
    return results
  }

  async checkpointActive(limit = 50) {
    const candidates = await this.repository.listActiveCheckpointCandidates(limit)
    const results: Array<{
      id: string
      status: 'exported' | 'unchanged' | 'suspended' | 'failed'
    }> = []
    for (const candidate of candidates) {
      try {
        const status = await this.lock.withLock(candidate.id, async ({ fencingToken }) => {
          const record = await this.repository.get(candidate.id)
          const handle = await this.fencedHandle(candidate.id, fencingToken)
          const driver = record && this.drivers.get(record.profile)
          if (!record || !handle || !driver || record.state.host !== 'running') return 'unchanged'
          const observation = await driver.inspect(handle, { probeServices: false })
          await this.sampleUsage(record.id, record.profile)
          const revision = observation.journalRevision
          if (!revision || revision === record.lastExportedJournalRevision) return 'unchanged'
          const receipt = await driver.exportDelta(handle, revision)
          record.lastExportedJournalRevision = receipt.revision
          record.pendingDeltaArtifactId = receipt.artifactId
          if (record.state.sync === 'clean') record.state.sync = 'pending_local_sync'
          record.revision += 1
          await this.repository.save(record, record.revision - 1)
          return 'exported'
        })
        try {
          this.quota.assertRuntimeEnabled(candidate.ownerUserId)
          await this.quota.assertBudget(candidate.ownerUserId)
          results.push({ id: candidate.id, status })
        } catch (error) {
          if (
            !(error instanceof PreviewRuntimeError) ||
            !['PREVIEW_ACCESS_DENIED', 'BUDGET_EXCEEDED'].includes(error.failure.code)
          ) {
            throw error
          }
          await this.orchestrator.command(
            candidate.id,
            { type: 'suspend-host' },
            `runtime-guard:${candidate.revision}:${candidate.generation}`
          )
          results.push({ id: candidate.id, status: 'suspended' })
        }
      } catch {
        results.push({ id: candidate.id, status: 'failed' })
      }
    }
    return results
  }

  private async sampleUsage(sessionId: string, profile: RuntimeProfileId) {
    const handle = await this.repository.getRuntimeHandle(sessionId)
    const session = await this.repository.get(sessionId)
    const driver = this.drivers.get(profile)
    if (!handle || !session || !driver) return
    try {
      const usage = await driver.usage(handle)
      const previousPeak = await PreviewUsageSample.query()
        .where('sessionId', sessionId)
        .where('generation', session.generation)
        .orderBy('cumulative_estimated_cost_usd', 'desc')
        .first()
      await PreviewUsageSample.create({
        sessionId,
        generation: session.generation,
        activeCpuSeconds: Math.round(usage.activeCpuSeconds),
        memoryGbSeconds: Math.round(usage.memoryGbSeconds),
        ingressBytes: Math.round(usage.ingressBytes),
        egressBytes: Math.round(usage.egressBytes),
        snapshotBytes: Math.round(usage.snapshotBytes),
        estimatedCostUsd: cumulativePeakDelta(
          usage.estimatedCostUsd,
          Number(previousPeak?.cumulativeEstimatedCostUsd ?? 0)
        ),
        cumulativeEstimatedCostUsd: usage.estimatedCostUsd,
        observedAt: DateTime.fromISO(usage.observedAt),
      })
    } catch {
      // Usage reconciliation is retried by the reaper and must not hide lifecycle results.
    }
  }

  private async fencedHandle(sessionId: string, fencingToken: number) {
    const handle = await this.repository.getRuntimeHandle(sessionId)
    if (!handle) return undefined
    fenceRuntimeHandle(handle, fencingToken)
    await this.repository.setRuntimeHandle(sessionId, handle)
    return handle
  }

  private async sweepProviderOrphans() {
    if (!previewRuntimeConfig().enabled) return
    const sweeper = [...this.drivers.values()].find((driver) => driver.sweepOrphans)
    if (!sweeper?.sweepOrphans) return
    const active = await PreviewSession.query()
      .whereIn('profile', ['vercel-compose', 'vercel-process'])
      .whereRaw("JSON_UNQUOTE(JSON_EXTRACT(state, '$.host')) <> 'destroyed'")
      .select('id')
    await sweeper.sweepOrphans(
      active.map(({ id }) => id),
      DateTime.utc().minus({ hours: 1 }).toISO()!
    )
  }

  private async usageSummary(sessionId: string, memoryGb: number) {
    const samples = await PreviewUsageSample.query()
      .where('sessionId', sessionId)
      .orderBy('observedAt', 'asc')
    const usage = summarizeCumulativeUsage(
      samples.map((sample) => ({
        generation: Number(sample.generation),
        memoryGbSeconds: Number(sample.memoryGbSeconds),
        cumulativeEstimatedCostUsd: Number(sample.cumulativeEstimatedCostUsd),
      })),
      memoryGb
    )
    return {
      ...usage,
      observedAt: samples.at(-1)?.observedAt.toUTC().toISO() ?? DateTime.utc().toISO()!,
    }
  }
}

function remoteWritersActive(state: { engine: string; agent: string }) {
  return !['idle', 'stopped', 'failed'].includes(state.engine) || state.agent !== 'idle'
}

function stableHash(value: unknown) {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function idempotentSessionId(ownerUserId: string, operationId: string) {
  const suffix = createHash('sha256')
    .update(`${ownerUserId}\0${operationId}`)
    .digest('hex')
    .slice(0, 32)
  return `preview_${suffix}`
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function validRecentConsent(value: string) {
  const consent = DateTime.fromISO(value)
  if (!consent.isValid || consent > DateTime.utc().plus({ minutes: 1 })) {
    throw new PreviewRuntimeError({
      code: 'PREVIEW_ACCESS_DENIED',
      message: 'Cloud upload consent is invalid.',
      retryable: false,
    })
  }
  return consent.toUTC().toISO()!
}

function validateOperationId(value: string) {
  if (!/^[A-Za-z0-9:_-]{8,80}$/.test(value)) throw new Error('Invalid operation ID.')
}

function assertOwner(actual: string, expected: string) {
  if (actual !== expected) {
    throw new PreviewRuntimeError({
      code: 'PREVIEW_ACCESS_DENIED',
      message: 'Preview session not found.',
      retryable: false,
    })
  }
}
