import DeploymentSourceArtifact from '#models/deployment_source_artifact'
import ProjectDeployment from '#models/project_deployment'
import ProjectDeployTarget from '#models/project_deploy_target'
import ProjectsService from '#services/projects_service'
import { parseDeploymentManifest, type DeploymentStatus } from '@blame/deploy-contract'
import { Exception } from '@adonisjs/core/exceptions'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { createHash } from 'node:crypto'
import type { Infer } from '@vinejs/vine/types'
import type {
  completeDeploymentSourceValidator,
  createDeploymentValidator,
} from '#validators/deployment'
import VercelConnection from '#models/vercel_connection'
import VercelConnectionsService from './vercel_connections_service.js'
import { deploymentArtifactKey, deploymentArtifactStorage } from './deployment_artifact_storage.js'
import { validateDeploymentSource } from './deployment_source_validator.js'
import { VercelApiError, type VercelDeploymentState } from './vercel_api_client.js'

type CreateInput = Infer<typeof createDeploymentValidator>
type CompleteInput = Infer<typeof completeDeploymentSourceValidator>
const maximumArchiveBytes = 100 * 1024 * 1024
const maximumFiles = 15_000
const activeStatuses: DeploymentStatus[] = [
  'packaging',
  'uploading_source',
  'transferring_to_vercel',
  'submitted',
  'building',
  'verifying_public_access',
  'canceling',
]

export default class ProjectDeploymentsService {
  async list(userId: string, projectId: string) {
    await new ProjectsService().findForUser(userId, projectId)
    const deployments = await ProjectDeployment.query()
      .where('projectId', projectId)
      .orderBy('createdAt', 'desc')
      .limit(5)
    return Promise.all(deployments.map((deployment) => this.reconcile(deployment)))
  }

  async show(userId: string, projectId: string, deploymentId: string) {
    const deployment = await this.owned(userId, projectId, deploymentId)
    return this.reconcile(deployment)
  }

  async create(userId: string, projectId: string, input: CreateInput) {
    await new ProjectsService().findForUser(userId, projectId)
    if (
      input.archive.size > maximumArchiveBytes ||
      input.snapshot.sourceBytes > maximumArchiveBytes ||
      input.snapshot.fileCount > maximumFiles
    ) {
      invalidSource('Deployment source exceeds its conservative limits')
    }
    const manifest = parseDeploymentManifest(input.manifest)
    const manifestHash = createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
    if (manifestHash !== input.snapshot.manifestHash) {
      invalidSource('Deployment manifest changed after preflight')
    }
    if (manifest.compatibility.status === 'unsupported') {
      invalidSource('This project is not compatible with Vercel deployment')
    }
    const result = await db.transaction(async (transaction) => {
      const target = await ProjectDeployTarget.query({ client: transaction })
        .where('id', input.targetId)
        .where('projectId', projectId)
        .forUpdate()
        .firstOrFail()
      if (JSON.stringify(target.deploymentManifest) !== JSON.stringify(manifest)) {
        invalidSource('Deployment target changed after preflight')
      }
      const connection = await VercelConnection.query({ client: transaction })
        .where('id', target.vercelConnectionId)
        .where('userId', userId)
        .where('status', 'active')
        .firstOrFail()
      const idempotent = await ProjectDeployment.query({ client: transaction })
        .where('projectId', projectId)
        .where('operationId', input.operationId)
        .first()
      if (idempotent) {
        const artifact = await DeploymentSourceArtifact.query({ client: transaction })
          .where('deploymentId', idempotent.id)
          .first()
        if (
          idempotent.workspaceHash !== input.snapshot.workspaceHash ||
          idempotent.manifestHash !== input.snapshot.manifestHash ||
          artifact?.sha256 !== input.archive.sha256 ||
          Number(artifact.size) !== input.archive.size
        ) {
          throw new Exception('Deployment retry does not match its original snapshot', {
            status: 409,
            code: 'E_DEPLOY_IDEMPOTENCY_MISMATCH',
          })
        }
        return {
          deployment: idempotent,
          artifact,
          resumeUpload:
            artifact.status === 'uploading' &&
            artifact.expiresAt > DateTime.utc() &&
            !idempotent.providerDeploymentId,
        }
      }
      const active = await ProjectDeployment.query({ client: transaction })
        .where('targetId', target.id)
        .whereIn('status', activeStatuses)
        .first()
      if (active) {
        return { deployment: active, artifact: null, resumeUpload: false }
      }
      const deployment = new ProjectDeployment()
      deployment.useTransaction(transaction)
      deployment.merge({
        projectId,
        targetId: target.id,
        vercelConnectionId: connection.id,
        operationId: input.operationId,
        providerDeploymentId: null,
        sourceRevision: input.snapshot.sourceRevision,
        sourceBranch: input.snapshot.sourceBranch,
        workspaceHash: input.snapshot.workspaceHash,
        manifestHash: input.snapshot.manifestHash,
        localChangeCount: input.snapshot.localChangeCount,
        fileCount: input.snapshot.fileCount,
        sourceBytes: input.snapshot.sourceBytes,
        status: 'uploading_source',
        providerState: null,
        deploymentUrl: null,
        productionUrl: null,
        errorCode: null,
        safeErrorMessage: null,
        providerRequestId: null,
        submittedAt: null,
        readyAt: null,
      })
      await deployment.save()
      const artifact = new DeploymentSourceArtifact()
      artifact.useTransaction(transaction)
      artifact.merge({
        deploymentId: deployment.id,
        status: 'uploading',
        objectKey: deploymentArtifactKey(deployment.id, crypto.randomUUID()),
        sha256: input.archive.sha256,
        size: input.archive.size,
        durableAt: null,
        deletedAt: null,
        expiresAt: DateTime.utc().plus({ hours: 24 }),
      })
      await artifact.save()
      return { deployment, artifact, resumeUpload: true }
    })
    return {
      deployment: serializeProjectDeployment(result.deployment),
      upload:
        result.resumeUpload && result.artifact ? await this.uploadTarget(result.artifact) : null,
    }
  }

  async complete(userId: string, projectId: string, deploymentId: string, input: CompleteInput) {
    const deployment = await this.owned(userId, projectId, deploymentId)
    if (deployment.providerDeploymentId) return deployment
    const artifact = await DeploymentSourceArtifact.query()
      .where('id', input.artifactId)
      .where('deploymentId', deployment.id)
      .firstOrFail()
    const storage = deploymentArtifactStorage()
    try {
      const metadata = await storage.head(artifact.objectKey)
      if (
        metadata.size !== artifact.size ||
        metadata.checksumSha256 !== artifact.sha256 ||
        metadata.serverSideEncryption !== 'AES256'
      ) {
        throw new Error('Deployment source artifact metadata is invalid')
      }
      if (!(await this.claimSourceTransfer(deployment, artifact))) {
        return this.owned(userId, projectId, deploymentId)
      }
      const content = await storage.content(artifact.objectKey)
      const files = await validateDeploymentSource(content, {
        sha256: artifact.sha256,
        size: artifact.size,
      })
      if (
        files.length !== deployment.fileCount ||
        files.reduce((total, file) => total + file.size, 0) !== Number(deployment.sourceBytes) ||
        workspaceHash(files, deployment.manifestHash) !== deployment.workspaceHash
      ) {
        throw new Error('Deployment source inventory changed after confirmation')
      }
      const target = await ProjectDeployTarget.findOrFail(deployment.targetId)
      const connections = new VercelConnectionsService()
      const connection = await connections.active(userId, deployment.vercelConnectionId)
      const client = await connections.client(connection)
      if (!target.vercelProjectId) {
        const project = await client.createProject({
          name: target.vercelProjectName,
          framework: target.framework,
          rootDirectory: target.rootDirectory,
          installCommand: target.deploymentManifest.installCommand,
          buildCommand: target.deploymentManifest.buildCommand,
          outputDirectory: target.deploymentManifest.outputDirectory,
        })
        target.merge({ vercelProjectId: project.id, vercelProjectName: project.name })
        await target.save()
      }
      await client.uploadFiles(files)
      const provider = await client.createProductionDeployment({
        name: target.vercelProjectName,
        projectId: target.vercelProjectId!,
        framework: target.framework,
        rootDirectory: target.rootDirectory,
        installCommand: target.deploymentManifest.installCommand,
        buildCommand: target.deploymentManifest.buildCommand,
        outputDirectory: target.deploymentManifest.outputDirectory,
        files,
        operationId: deployment.operationId,
        sourceRevision: deployment.sourceRevision,
        sourceBranch: deployment.sourceBranch,
      })
      deployment.merge({
        providerDeploymentId: provider.id,
        providerState: provider.state,
        deploymentUrl: provider.url,
        productionUrl: productionUrl(provider),
        status: providerStatus(provider.state),
        submittedAt: DateTime.utc(),
      })
      await deployment.save()
      await this.deleteArtifact(artifact).catch(() => undefined)
      return this.reconcile(deployment)
    } catch (error) {
      await this.deleteArtifact(artifact).catch(() => undefined)
      await this.fail(deployment, error)
      throw safeDeploymentException(error)
    }
  }

  async cancel(userId: string, projectId: string, deploymentId: string) {
    const deployment = await this.owned(userId, projectId, deploymentId)
    if (!activeStatuses.includes(deployment.status)) return deployment
    deployment.status = 'canceling'
    await deployment.save()
    if (deployment.providerDeploymentId) {
      const connection = await VercelConnection.findOrFail(deployment.vercelConnectionId)
      const client = await new VercelConnectionsService().client(connection)
      const provider = await client.cancelDeployment(deployment.providerDeploymentId)
      deployment.providerState = provider.state
    }
    deployment.status = 'canceled'
    await deployment.save()
    const artifact = await DeploymentSourceArtifact.query()
      .where('deploymentId', deployment.id)
      .first()
    if (artifact) await this.deleteArtifact(artifact).catch(() => undefined)
    return deployment
  }

  async logs(userId: string, projectId: string, deploymentId: string) {
    const deployment = await this.owned(userId, projectId, deploymentId)
    if (!deployment.providerDeploymentId) return []
    const connection = await VercelConnection.findOrFail(deployment.vercelConnectionId)
    const client = await new VercelConnectionsService().client(connection)
    return client.logs(deployment.providerDeploymentId)
  }

  async cleanupExpired(limit = 100) {
    const artifacts = await DeploymentSourceArtifact.query()
      .where('expiresAt', '<=', DateTime.utc().toJSDate())
      .whereNot('status', 'deleted')
      .limit(limit)
    let deleted = 0
    for (const artifact of artifacts) {
      try {
        await this.deleteArtifact(artifact)
        deleted += 1
      } catch {}
    }
    return { deleted, processed: artifacts.length }
  }

  private async reconcile(deployment: ProjectDeployment) {
    if (
      !deployment.providerDeploymentId ||
      !['submitted', 'building', 'verifying_public_access'].includes(deployment.status)
    ) {
      return deployment
    }
    try {
      const connection = await VercelConnection.findOrFail(deployment.vercelConnectionId)
      const client = await new VercelConnectionsService().client(connection)
      const provider = await client.deployment(deployment.providerDeploymentId)
      deployment.merge({
        providerState: provider.state,
        deploymentUrl: provider.url ?? deployment.deploymentUrl,
        productionUrl: productionUrl(provider) ?? deployment.productionUrl,
      })
      const status = providerStatus(provider.state)
      if (status === 'verifying_public_access') {
        deployment.status = 'verifying_public_access'
        await deployment.save()
        if (!deployment.productionUrl) return deployment
        const publicStatus = await probePublicUrl(deployment.productionUrl)
        deployment.status = publicStatus
        deployment.readyAt = DateTime.utc()
        const target = await ProjectDeployTarget.find(deployment.targetId)
        if (target) {
          target.productionUrl = deployment.productionUrl
          await target.save()
        }
      } else {
        deployment.status = status
        if (status === 'failed') {
          deployment.errorCode = 'DEPLOY_BUILD_FAILED'
          deployment.safeErrorMessage =
            'Vercel could not build this deployment. View the build logs for details.'
        }
      }
      await deployment.save()
    } catch (error) {
      if (error instanceof VercelApiError && [401, 403].includes(error.status)) {
        await this.invalidateConnection(deployment.vercelConnectionId, error.status)
        await this.fail(deployment, error)
      }
    }
    return deployment
  }

  private async owned(userId: string, projectId: string, deploymentId: string) {
    await new ProjectsService().findForUser(userId, projectId)
    return ProjectDeployment.query()
      .where('id', deploymentId)
      .where('projectId', projectId)
      .firstOrFail()
  }

  private uploadTarget(artifact: DeploymentSourceArtifact) {
    return deploymentArtifactStorage()
      .presignUpload(artifact.objectKey, {
        checksumSha256: artifact.sha256,
        contentType: 'application/gzip',
        encryptionScope: `deployment:${artifact.deploymentId}`,
        serverSideEncryption: 'AES256',
        size: artifact.size,
      })
      .then((target) => ({ artifactId: artifact.id, ...target }))
  }

  private claimSourceTransfer(deployment: ProjectDeployment, artifact: DeploymentSourceArtifact) {
    return db.transaction(async (transaction) => {
      const currentDeployment = await ProjectDeployment.query({ client: transaction })
        .where('id', deployment.id)
        .forUpdate()
        .firstOrFail()
      const currentArtifact = await DeploymentSourceArtifact.query({ client: transaction })
        .where('id', artifact.id)
        .forUpdate()
        .firstOrFail()
      if (
        currentDeployment.providerDeploymentId ||
        currentDeployment.status !== 'uploading_source' ||
        !['uploading', 'durable'].includes(currentArtifact.status)
      ) {
        return false
      }
      currentDeployment.status = 'transferring_to_vercel'
      currentArtifact.merge({ status: 'transferring', durableAt: DateTime.utc() })
      await Promise.all([currentDeployment.save(), currentArtifact.save()])
      deployment.status = currentDeployment.status
      artifact.merge({ status: currentArtifact.status, durableAt: currentArtifact.durableAt })
      return true
    })
  }

  private async deleteArtifact(artifact: DeploymentSourceArtifact) {
    if (artifact.status !== 'deleted') {
      await deploymentArtifactStorage().delete([artifact.objectKey])
      artifact.merge({ status: 'deleted', deletedAt: DateTime.utc() })
      await artifact.save()
    }
  }

  private async fail(deployment: ProjectDeployment, error: unknown) {
    const failure = safeFailure(error)
    deployment.merge({
      status: 'failed',
      errorCode: failure.code,
      safeErrorMessage: failure.message,
      providerRequestId: error instanceof VercelApiError ? (error.requestId ?? null) : null,
    })
    await deployment.save()
  }

  private invalidateConnection(connectionId: string, status: number) {
    return VercelConnection.query()
      .where('id', connectionId)
      .update({
        status: status === 401 ? 'invalid' : 'disabled',
        lastValidatedAt: DateTime.utc(),
      })
  }
}

export function serializeProjectDeployment(deployment: ProjectDeployment) {
  return {
    id: deployment.id,
    projectId: deployment.projectId,
    targetId: deployment.targetId,
    operationId: deployment.operationId,
    status: deployment.status,
    providerState: deployment.providerState,
    sourceRevision: deployment.sourceRevision,
    sourceBranch: deployment.sourceBranch,
    localChangeCount: deployment.localChangeCount,
    fileCount: deployment.fileCount,
    sourceBytes: Number(deployment.sourceBytes),
    deploymentUrl: deployment.deploymentUrl,
    productionUrl: deployment.productionUrl,
    errorCode: deployment.errorCode,
    safeErrorMessage: deployment.safeErrorMessage,
    createdAt: deployment.createdAt.toISO(),
    submittedAt: deployment.submittedAt?.toISO() ?? null,
    readyAt: deployment.readyAt?.toISO() ?? null,
    updatedAt: deployment.updatedAt?.toISO() ?? null,
  }
}

function providerStatus(value: string): DeploymentStatus {
  switch (value.toUpperCase()) {
    case 'READY':
      return 'verifying_public_access'
    case 'ERROR':
      return 'failed'
    case 'CANCELED':
    case 'CANCELLED':
      return 'canceled'
    case 'QUEUED':
    case 'INITIALIZING':
    case 'BUILDING':
      return 'building'
    default:
      return 'building'
  }
}

function productionUrl(provider: VercelDeploymentState) {
  return (
    provider.aliases.find((value) => {
      try {
        return new URL(value).hostname.endsWith('.vercel.app')
      } catch {
        return false
      }
    }) ?? null
  )
}

async function probePublicUrl(value: string | null): Promise<'ready' | 'protected' | 'unhealthy'> {
  if (!value) return 'unhealthy'
  let url = safeProbeUrl(value)
  if (!url) return 'unhealthy'
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8_000)
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Range': 'bytes=0-0', 'User-Agent': 'Blame-Public-Deployment-Probe/1.0' },
        redirect: 'manual',
        signal: controller.signal,
      })
      if (response.status >= 200 && response.status < 300) return 'ready'
      if ([401, 403].includes(response.status)) return 'protected'
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        url = location ? safeProbeUrl(new URL(location, url).toString()) : null
        if (!url) return 'unhealthy'
        continue
      }
      return 'unhealthy'
    } catch {
      return 'unhealthy'
    } finally {
      clearTimeout(timeout)
    }
  }
  return 'unhealthy'
}

function safeProbeUrl(value: string) {
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !url.hostname.endsWith('.vercel.app')
    ) {
      return null
    }
    return url
  } catch {
    return null
  }
}

function safeFailure(error: unknown) {
  if (error instanceof Exception && error.code === 'E_VERCEL_CONNECTION_INACTIVE') {
    return { code: 'DEPLOY_VERCEL_RECONNECT', message: 'Reconnect Vercel to deploy again.' }
  }
  if (error instanceof VercelApiError) {
    if (error.status === 401) {
      return { code: 'DEPLOY_VERCEL_RECONNECT', message: 'Reconnect Vercel to deploy again.' }
    }
    if (error.status === 403) {
      return {
        code: 'DEPLOY_VERCEL_ACCESS_REQUIRED',
        message: 'Manage access in Vercel and make sure this project is available to Blame.',
      }
    }
    if (error.code === 'project_already_exists') {
      return {
        code: 'DEPLOY_PROJECT_NAME_TAKEN',
        message: 'A Vercel project with this name already exists. Choose it explicitly.',
      }
    }
    return { code: 'DEPLOY_PROVIDER_ERROR', message: 'Vercel could not accept this deployment.' }
  }
  return {
    code: 'DEPLOY_SOURCE_INVALID',
    message: 'The deployment source could not be validated. Run preflight again.',
  }
}

function safeDeploymentException(error: unknown) {
  const failure = safeFailure(error)
  return new Exception(failure.message, { status: 422, code: failure.code, cause: error })
}

function invalidSource(message: string): never {
  throw new Exception(message, { status: 422, code: 'E_DEPLOY_SOURCE_INVALID' })
}

function workspaceHash(
  files: Awaited<ReturnType<typeof validateDeploymentSource>>,
  manifestHash: string
) {
  const hash = createHash('sha256')
  hash.update(`manifest\0${manifestHash}\0`)
  for (const file of files) {
    const contentHash = createHash('sha256').update(file.content).digest('hex')
    hash.update(`${file.file}\0${file.mode}\0${file.size}\0${contentHash}\0`)
  }
  return hash.digest('hex')
}
