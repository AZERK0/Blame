import PreviewOperation from '#models/preview_operation'
import PreviewSession from '#models/preview_session'
import encryption from '@adonisjs/core/services/encryption'
import { DateTime } from 'luxon'
import {
  OptimisticRevisionError,
  runtimeHandle,
  type EndpointMap,
  type PreviewExecutionPlan,
  type PreviewFailure,
  type PreviewOperationRecord,
  type PreviewSessionDesired,
  type PreviewSessionRecord,
  type PreviewSessionState,
  type RuntimeHandle,
  type RuntimeProfileId,
  type SessionRepository,
} from '@blame/preview-runtime'

export default class PreviewSessionRepository implements SessionRepository {
  async create(record: PreviewSessionRecord) {
    await PreviewSession.create(modelPayload(record))
  }

  async get(sessionId: string) {
    const model = await PreviewSession.find(sessionId)
    return model ? this.record(model) : undefined
  }

  async save(record: PreviewSessionRecord, expectedRevision: number) {
    const payload = await mutableModelPayload(record)
    const updated = await PreviewSession.query()
      .where('id', record.id)
      .where('revision', expectedRevision)
      .where('fencingToken', record.fencingToken)
      .update(payload)
    if (affectedRows(updated) !== 1) throw new OptimisticRevisionError()
  }

  async listReconcileCandidates(now: string, limit: number) {
    const models = await PreviewSession.query()
      .whereNotNull('providerHandleEncrypted')
      .whereRaw(
        "JSON_UNQUOTE(JSON_EXTRACT(state, '$.host')) NOT IN ('suspended', 'suspending', 'destroyed', 'destroying', 'unprovisioned')"
      )
      .whereNotNull('idleDeadlineAt')
      .where((query) => {
        query.where('idleDeadlineAt', '<=', DateTime.fromISO(now).toJSDate())
      })
      .orderBy('lastActivityAt', 'asc')
      .limit(limit)
    return Promise.all(models.map((model) => this.record(model)))
  }

  async listActiveCheckpointCandidates(limit: number) {
    const models = await PreviewSession.query()
      .whereRaw("JSON_UNQUOTE(JSON_EXTRACT(state, '$.host')) = 'running'")
      .whereNotNull('providerHandleEncrypted')
      .orderBy('updatedAt', 'asc')
      .limit(limit)
    return Promise.all(models.map((model) => this.record(model)))
  }

  async listSuspendedSnapshotCandidates(cutoff: string, maxRetained: number, limit: number) {
    const suspended = () =>
      PreviewSession.query()
        .whereNotNull('providerHandleEncrypted')
        .whereRaw("JSON_UNQUOTE(JSON_EXTRACT(state, '$.host')) = 'suspended'")
    const expired = await suspended()
      .where('lastActivityAt', '<=', DateTime.fromISO(cutoff).toJSDate())
      .orderBy('lastActivityAt', 'asc')
      .limit(limit)
    const newest = await suspended()
      .orderBy('lastActivityAt', 'desc')
      .orderBy('id', 'desc')
      .limit(maxRetained + limit)
    const overflow = newest.slice(maxRetained)
    const candidates = [
      ...new Map([...expired, ...overflow].map((model) => [model.id, model])).values(),
    ]
      .sort((left, right) => left.lastActivityAt.toMillis() - right.lastActivityAt.toMillis())
      .slice(0, limit)
    return Promise.all(candidates.map((model) => this.record(model)))
  }

  async getRuntimeHandle(sessionId: string) {
    const model = await PreviewSession.query().where('id', sessionId).first()
    if (!model?.providerHandleEncrypted) return undefined
    return runtimeHandle(await decryptJson<Record<string, unknown>>(model.providerHandleEncrypted))
  }

  async setRuntimeHandle(
    sessionId: string,
    handle: RuntimeHandle | undefined,
    fencingToken?: number
  ) {
    const value = handle ? await encryption.encrypt(JSON.stringify(handle)) : null
    const token = handle?.fencingToken ?? fencingToken
    const query = PreviewSession.query().where('id', sessionId)
    if (token !== undefined) query.where('fencingToken', token)
    const updated = await query.update({ providerHandleEncrypted: value })
    if (affectedRows(updated) !== 1) throw new OptimisticRevisionError()
  }

  async getOperation(sessionId: string, operationId: string) {
    const operation = await PreviewOperation.query()
      .where('sessionId', sessionId)
      .where('operationId', operationId)
      .first()
    return operation ? operationRecord(operation) : undefined
  }

  async saveOperation(operation: PreviewOperationRecord) {
    const existing = await PreviewOperation.query()
      .where('sessionId', operation.sessionId)
      .where('operationId', operation.operationId)
      .first()
    const payload = {
      commandType: operation.commandType,
      status: operation.status,
      resultRevision: operation.resultRevision ?? null,
      errorCode: operation.errorCode ?? null,
      completedAt: optionalDate(operation.completedAt),
    }
    if (existing) {
      existing.merge(payload)
      await existing.save()
      return
    }
    await PreviewOperation.create({
      ...payload,
      sessionId: operation.sessionId,
      operationId: operation.operationId,
      createdAt: DateTime.fromISO(operation.createdAt),
    })
  }

  private async record(model: PreviewSession): Promise<PreviewSessionRecord> {
    return {
      id: model.id,
      userStoryId: model.userStoryId,
      ownerUserId: model.ownerUserId,
      profile: model.profile as RuntimeProfileId,
      desired: parseJson<PreviewSessionDesired>(model.desired),
      state: parseJson<PreviewSessionState>(model.state),
      revision: model.revision,
      generation: Number(model.generation),
      fencingToken: Number(model.fencingToken),
      providerHandleEncrypted: model.providerHandleEncrypted ?? undefined,
      plan: parseJson<PreviewExecutionPlan>(model.plan),
      planHash: model.planHash,
      planVersion: model.planVersion,
      protocolVersion: model.protocolVersion ?? undefined,
      runnerVersion: model.runnerVersion ?? undefined,
      imageDigest: model.imageDigest ?? undefined,
      sourceRevision: model.sourceRevision ?? undefined,
      workspaceHash: model.workspaceHash ?? undefined,
      sourceArtifactId: model.sourceArtifactId ?? undefined,
      baselineId: model.baselineId ?? undefined,
      provisionSource: model.provisionSource
        ? parseJson<import('@blame/preview-runtime').RuntimeProvisionSource>(model.provisionSource)
        : undefined,
      lastExportedJournalRevision: model.lastExportedJournalRevision ?? undefined,
      lastAppliedLocalRevision: model.lastAppliedLocalRevision ?? undefined,
      lastAcknowledgedRemoteRevision: model.lastAcknowledgedRemoteRevision ?? undefined,
      pendingDeltaArtifactId: model.pendingDeltaArtifactId ?? undefined,
      endpointMapEncrypted: model.endpointMapEncrypted ?? undefined,
      endpointMap: model.endpointMapEncrypted
        ? await decryptJson<EndpointMap>(model.endpointMapEncrypted)
        : undefined,
      resourceSize: { vcpus: model.resourceVcpus, memoryGb: model.resourceMemoryGb },
      failure: model.failure ? parseJson<PreviewFailure>(model.failure) : undefined,
      selection: model.selection
        ? parseJson<import('@blame/preview-runtime').RuntimeSelection>(model.selection)
        : undefined,
      lastActivityAt: model.lastActivityAt.toUTC().toISO()!,
      leaseExpiresAt: model.leaseExpiresAt?.toUTC().toISO() ?? undefined,
      idleDeadlineAt: model.idleDeadlineAt?.toUTC().toISO() ?? undefined,
      createdAt: model.createdAt.toUTC().toISO()!,
      stoppedAt: model.stoppedAt?.toUTC().toISO() ?? undefined,
    }
  }
}

function modelPayload(record: PreviewSessionRecord) {
  return {
    id: record.id,
    userStoryId: record.userStoryId,
    ownerUserId: record.ownerUserId,
    profile: record.profile,
    desired: JSON.stringify(record.desired),
    state: JSON.stringify(record.state),
    revision: record.revision,
    generation: record.generation,
    fencingToken: record.fencingToken,
    providerHandleEncrypted: record.providerHandleEncrypted ?? null,
    plan: JSON.stringify(record.plan),
    planHash: record.planHash,
    planVersion: record.planVersion,
    protocolVersion: record.protocolVersion ?? null,
    runnerVersion: record.runnerVersion ?? null,
    imageDigest: record.imageDigest ?? null,
    sourceRevision: record.sourceRevision ?? null,
    workspaceHash: record.workspaceHash ?? null,
    sourceArtifactId: record.sourceArtifactId ?? null,
    baselineId: record.baselineId ?? null,
    provisionSource: record.provisionSource ? JSON.stringify(record.provisionSource) : null,
    lastExportedJournalRevision: record.lastExportedJournalRevision ?? null,
    lastAppliedLocalRevision: record.lastAppliedLocalRevision ?? null,
    lastAcknowledgedRemoteRevision: record.lastAcknowledgedRemoteRevision ?? null,
    pendingDeltaArtifactId: record.pendingDeltaArtifactId ?? null,
    endpointMapEncrypted: record.endpointMapEncrypted ?? null,
    resourceVcpus: record.resourceSize.vcpus,
    resourceMemoryGb: record.resourceSize.memoryGb,
    failure: record.failure ? JSON.stringify(record.failure) : null,
    selection: record.selection ? JSON.stringify(record.selection) : null,
    lastActivityAt: DateTime.fromISO(record.lastActivityAt),
    leaseExpiresAt: optionalDate(record.leaseExpiresAt),
    idleDeadlineAt: optionalDate(record.idleDeadlineAt),
    stoppedAt: optionalDate(record.stoppedAt),
    createdAt: DateTime.fromISO(record.createdAt),
  }
}

async function mutableModelPayload(record: PreviewSessionRecord) {
  return {
    desired: JSON.stringify(record.desired),
    state: JSON.stringify(record.state),
    revision: record.revision,
    generation: record.generation,
    fencingToken: record.fencingToken,
    plan: JSON.stringify(record.plan),
    planHash: record.planHash,
    planVersion: record.planVersion,
    protocolVersion: record.protocolVersion ?? null,
    runnerVersion: record.runnerVersion ?? null,
    imageDigest: record.imageDigest ?? null,
    sourceRevision: record.sourceRevision ?? null,
    workspaceHash: record.workspaceHash ?? null,
    sourceArtifactId: record.sourceArtifactId ?? null,
    baselineId: record.baselineId ?? null,
    provisionSource: record.provisionSource ? JSON.stringify(record.provisionSource) : null,
    lastExportedJournalRevision: record.lastExportedJournalRevision ?? null,
    lastAppliedLocalRevision: record.lastAppliedLocalRevision ?? null,
    lastAcknowledgedRemoteRevision: record.lastAcknowledgedRemoteRevision ?? null,
    pendingDeltaArtifactId: record.pendingDeltaArtifactId ?? null,
    endpointMapEncrypted: record.endpointMap
      ? await encryption.encrypt(JSON.stringify(record.endpointMap))
      : null,
    resourceVcpus: record.resourceSize.vcpus,
    resourceMemoryGb: record.resourceSize.memoryGb,
    failure: record.failure ? JSON.stringify(record.failure) : null,
    selection: record.selection ? JSON.stringify(record.selection) : null,
    lastActivityAt: DateTime.fromISO(record.lastActivityAt),
    leaseExpiresAt: optionalDate(record.leaseExpiresAt),
    idleDeadlineAt: optionalDate(record.idleDeadlineAt),
    stoppedAt: optionalDate(record.stoppedAt),
  }
}

function operationRecord(model: PreviewOperation): PreviewOperationRecord {
  return {
    sessionId: model.sessionId,
    operationId: model.operationId,
    commandType: model.commandType,
    status: model.status as PreviewOperationRecord['status'],
    resultRevision: model.resultRevision ?? undefined,
    errorCode: model.errorCode ?? undefined,
    createdAt: model.createdAt.toUTC().toISO()!,
    completedAt: model.completedAt?.toUTC().toISO() ?? undefined,
  }
}

function optionalDate(value: string | undefined) {
  return value ? DateTime.fromISO(value) : null
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T
}

async function decryptJson<T>(value: string): Promise<T> {
  const decrypted = await encryption.decrypt(value)
  if (typeof decrypted !== 'string') throw new Error('Encrypted preview value is invalid.')
  return parseJson<T>(decrypted)
}

function affectedRows(value: unknown) {
  if (typeof value === 'number') return value
  if (Array.isArray(value) && typeof value[0] === 'number') return value[0]
  return 0
}
