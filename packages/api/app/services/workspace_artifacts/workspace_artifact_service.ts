import { workspaceArtifactObjectStorage } from '#services/workspace_artifacts/workspace_artifact_object_storage'
import PreviewSession from '#models/preview_session'
import PreviewWorkspaceArtifact from '#models/preview_workspace_artifact'
import {
  validateSourceArtifact,
  validateSourceDeltaArtifact,
} from '#services/workspace_artifacts/source_artifact_validator'
import { DateTime } from 'luxon'
import { appKey } from '#config/app'
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { DurableDeltaReceipt, SourceArtifact } from '@blame/preview-runtime'

const maximumArtifactBytes = 256 * 1024 * 1024
const artifactRetentionHours = 72

export default class WorkspaceArtifactService {
  async prepareSourceUpload(input: {
    sessionId: string
    ownerUserId: string
    sha256: string
    size: number
    sourceRevision: string
    sanitizedTreeHash?: string
    lockfileHash?: string
    workspaceHash?: string
    mode?: 'full' | 'delta'
  }) {
    await ownedSession(input.sessionId, input.ownerUserId)
    validateMetadata(input.sha256, input.size)
    const artifact = await PreviewWorkspaceArtifact.create({
      sessionId: input.sessionId,
      kind: 'source',
      mode: input.mode ?? 'full',
      status: 'uploading',
      objectKey: pendingObjectKey(input.sessionId),
      sha256: input.sha256,
      size: input.size,
      sourceRevision: input.sourceRevision,
      sanitizedTreeHash: input.sanitizedTreeHash ?? null,
      lockfileHash: input.lockfileHash ?? null,
      workspaceHash: input.workspaceHash ?? null,
      baseHash: null,
      finalHash: null,
      generation: null,
      durableAt: null,
      appliedAt: null,
      discardedAt: null,
      expiresAt: DateTime.utc().plus({ hours: artifactRetentionHours }),
    })
    artifact.objectKey = artifactObjectKey(input.sessionId, artifact.id, 'source')
    await artifact.save()
    const upload = await workspaceArtifactObjectStorage().presignUpload(artifact.objectKey, {
      checksumSha256: artifact.sha256,
      contentType: 'application/gzip',
      encryptionScope: input.sessionId,
      size: artifact.size,
    })
    return { artifactId: artifact.id, ...upload }
  }

  async completeSourceUpload(artifactId: string, ownerUserId: string): Promise<SourceArtifact> {
    const artifact = await sourceArtifact(artifactId, ownerUserId)
    if (artifact.status === 'durable') return this.sourceArtifact(artifact)
    if (artifact.status !== 'uploading') throw new Error('Source artifact cannot be completed.')
    const metadata = await workspaceArtifactObjectStorage().head(artifact.objectKey)
    if (
      metadata.size !== artifact.size ||
      metadata.checksumSha256 !== artifact.sha256 ||
      metadata.encryptionScope !== artifact.sessionId
    ) {
      await markInvalid(artifact)
      throw new Error('Uploaded source artifact metadata does not match its declaration.')
    }
    try {
      const content = await workspaceArtifactObjectStorage().content(artifact.objectKey)
      await (artifact.mode === 'delta' ? validateSourceDeltaArtifact : validateSourceArtifact)(
        content,
        {
          sha256: artifact.sha256,
          size: artifact.size,
        }
      )
    } catch (error) {
      await markInvalid(artifact)
      throw error
    }
    artifact.status = 'durable'
    artifact.durableAt = DateTime.utc()
    await artifact.save()
    return this.sourceArtifact(artifact)
  }

  async source(artifactId: string, ownerUserId: string) {
    const artifact = await sourceArtifact(artifactId, ownerUserId)
    if (artifact.status !== 'durable') throw new Error('Source artifact is not durable.')
    return this.sourceArtifact(artifact)
  }

  async prepareDeltaUpload(sessionId: string, generation: number) {
    const artifact = await PreviewWorkspaceArtifact.create({
      sessionId,
      kind: 'delta',
      status: 'uploading',
      objectKey: pendingObjectKey(sessionId),
      sha256: '0'.repeat(64),
      size: 0,
      sourceRevision: null,
      sanitizedTreeHash: null,
      lockfileHash: null,
      workspaceHash: null,
      baseHash: null,
      finalHash: null,
      generation,
      durableAt: null,
      appliedAt: null,
      discardedAt: null,
      expiresAt: DateTime.utc().plus({ hours: artifactRetentionHours }),
    })
    artifact.objectKey = artifactObjectKey(sessionId, artifact.id, 'delta')
    await artifact.save()
    return {
      artifactId: artifact.id,
      objectKey: artifact.objectKey,
      expiresAt: artifact.expiresAt.toISO()!,
    }
  }

  async deltaUploadTarget(artifactId: string, sha256: string, size: number) {
    validateMetadata(sha256, size)
    const artifact = await PreviewWorkspaceArtifact.query()
      .where('id', artifactId)
      .where('kind', 'delta')
      .where('status', 'uploading')
      .firstOrFail()
    artifact.merge({ sha256, size })
    await artifact.save()
    return workspaceArtifactObjectStorage().presignUpload(artifact.objectKey, {
      checksumSha256: sha256,
      contentType: 'application/gzip',
      encryptionScope: artifact.sessionId,
      size,
    })
  }

  async confirmDelta(receipt: DurableDeltaReceipt & { sha256: string; size: number }) {
    const artifact = await PreviewWorkspaceArtifact.query()
      .where('id', receipt.artifactId)
      .where('kind', 'delta')
      .firstOrFail()
    const metadata = await workspaceArtifactObjectStorage().head(artifact.objectKey)
    if (
      metadata.size !== receipt.size ||
      metadata.checksumSha256 !== receipt.sha256 ||
      metadata.encryptionScope !== artifact.sessionId
    ) {
      await markInvalid(artifact)
      throw new Error('Delta artifact metadata mismatch.')
    }
    artifact.merge({
      status: 'durable',
      sha256: receipt.sha256,
      size: receipt.size,
      baseHash: receipt.baseHash,
      finalHash: receipt.finalHash,
      generation: receipt.generation,
      sourceRevision: receipt.revision,
      durableAt: DateTime.fromISO(receipt.durableAt),
    })
    await artifact.save()
    return receipt
  }

  async download(artifactId: string, ownerUserId: string) {
    const artifact = await PreviewWorkspaceArtifact.query()
      .where('id', artifactId)
      .where('status', 'durable')
      .whereIn('sessionId', PreviewSession.query().select('id').where('ownerUserId', ownerUserId))
      .firstOrFail()
    return {
      artifactId: artifact.id,
      sha256: artifact.sha256,
      size: artifact.size,
      mode: artifact.mode ?? 'full',
      baseHash: artifact.baseHash,
      finalHash: artifact.finalHash,
      generation: artifact.generation,
      revision: artifact.sourceRevision,
      discardConfirmationId: discardConfirmationId(artifact.id),
      url: await workspaceArtifactObjectStorage().presignDownload(
        artifact.objectKey,
        `${artifact.id}.tar.gz`
      ),
    }
  }

  async markApplied(artifactId: string, ownerUserId: string) {
    const artifact = await ownedDelta(artifactId, ownerUserId)
    artifact.status = 'applied'
    artifact.appliedAt = DateTime.utc()
    await artifact.save()
  }

  async discard(artifactId: string, ownerUserId: string, confirmationId: string) {
    const artifact = await ownedDelta(artifactId, ownerUserId)
    const expected = discardConfirmationId(artifact.id)
    if (!safeEqual(expected, confirmationId)) throw new Error('Invalid delta discard confirmation.')
    artifact.status = 'discarded'
    artifact.discardedAt = DateTime.utc()
    await artifact.save()
  }

  async scheduleSessionDeletion(sessionId: string) {
    try {
      await this.deleteSessionArtifacts(sessionId)
    } catch {
      // Expired rows remain durable so cleanupExpired can retry object deletion.
    }
  }

  async deleteSessionArtifacts(sessionId: string) {
    const artifacts = await PreviewWorkspaceArtifact.query().where('sessionId', sessionId)
    const expiresAt = DateTime.utc()
    for (const artifact of artifacts) {
      artifact.expiresAt = expiresAt
      if (!['applied', 'discarded'].includes(artifact.status)) artifact.status = 'discarded'
      artifact.discardedAt ??= expiresAt
      await artifact.save()
    }
    await workspaceArtifactObjectStorage().delete(artifacts.map(({ objectKey }) => objectKey))
    await PreviewWorkspaceArtifact.query().where('sessionId', sessionId).delete()
  }

  async cleanupExpired(limit = 250) {
    const artifacts = await PreviewWorkspaceArtifact.query()
      .where('expiresAt', '<=', DateTime.utc().toJSDate())
      .orderBy('expiresAt', 'asc')
      .limit(limit)
    for (const artifact of artifacts) {
      try {
        await workspaceArtifactObjectStorage().delete([artifact.objectKey])
        await artifact.delete()
      } catch {}
    }
  }

  private async sourceArtifact(artifact: PreviewWorkspaceArtifact): Promise<SourceArtifact> {
    return {
      id: artifact.id,
      revision: artifact.sourceRevision!,
      mode: artifact.mode ?? 'full',
      downloadUrl: await workspaceArtifactObjectStorage().presignDownload(
        artifact.objectKey,
        `${artifact.id}.tar.gz`
      ),
      sha256: artifact.sha256,
      size: artifact.size,
      sanitizedTreeHash: artifact.sanitizedTreeHash ?? undefined,
      lockfileHash: artifact.lockfileHash ?? undefined,
      workspaceHash: artifact.workspaceHash ?? undefined,
    }
  }
}

async function sourceArtifact(id: string, ownerUserId: string) {
  return PreviewWorkspaceArtifact.query()
    .where('id', id)
    .where('kind', 'source')
    .whereIn('sessionId', PreviewSession.query().select('id').where('ownerUserId', ownerUserId))
    .firstOrFail()
}

async function ownedSession(id: string, ownerUserId: string) {
  return PreviewSession.query().where('id', id).where('ownerUserId', ownerUserId).firstOrFail()
}

async function ownedDelta(id: string, ownerUserId: string) {
  return PreviewWorkspaceArtifact.query()
    .where('id', id)
    .where('kind', 'delta')
    .whereIn('sessionId', PreviewSession.query().select('id').where('ownerUserId', ownerUserId))
    .firstOrFail()
}

function validateMetadata(sha256: string, size: number) {
  if (
    !/^[a-f0-9]{64}$/.test(sha256) ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > maximumArtifactBytes
  ) {
    throw new Error('Invalid workspace artifact metadata.')
  }
}

async function markInvalid(artifact: PreviewWorkspaceArtifact) {
  artifact.status = 'invalid'
  await artifact.save()
  await workspaceArtifactObjectStorage().delete([artifact.objectKey])
}

function pendingObjectKey(sessionId: string) {
  return `preview-runtime/${sessionId}/pending/${crypto.randomUUID()}`
}

function artifactObjectKey(sessionId: string, artifactId: string, kind: string) {
  return `preview-runtime/${sessionId}/${kind}/${artifactId}.tar.gz`
}

function discardConfirmationId(artifactId: string) {
  return createHmac('sha256', appKey.release())
    .update(`discard-preview-delta\0${artifactId}`)
    .digest('base64url')
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}
