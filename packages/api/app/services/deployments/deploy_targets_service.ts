import ProjectDeployTarget from '#models/project_deploy_target'
import ProjectDeployment from '#models/project_deployment'
import ProjectsService from '#services/projects_service'
import VercelConnectionsService from './vercel_connections_service.js'
import { parseDeploymentManifest } from '@blame/deploy-contract'
import { Exception } from '@adonisjs/core/exceptions'
import type { Infer } from '@vinejs/vine/types'
import type { updateDeployTargetValidator } from '#validators/deployment'
import db from '@adonisjs/lucid/services/db'

type UpdateTargetInput = Infer<typeof updateDeployTargetValidator>

export default class DeployTargetsService {
  async show(userId: string, projectId: string) {
    await new ProjectsService().findForUser(userId, projectId)
    return ProjectDeployTarget.query().where('projectId', projectId).first()
  }

  async update(userId: string, projectId: string, input: UpdateTargetInput) {
    await new ProjectsService().findForUser(userId, projectId)
    const connections = new VercelConnectionsService()
    await connections.active(userId, input.connectionId)
    const manifest = parseDeploymentManifest(input.manifest)
    let providerProjectId = input.providerProjectId ?? null
    let providerProjectName = normalizedProjectName(input.providerProjectName)
    if (providerProjectId) {
      const project = await connections.project(userId, input.connectionId, providerProjectId)
      if (!project) providerProjectUnavailable()
      providerProjectId = project.id
      providerProjectName = project.name
    } else {
      const collision = await connections.findProjectByName(
        userId,
        input.connectionId,
        providerProjectName
      )
      if (collision) {
        throw new Exception(
          'A Vercel project with this name already exists. Choose it explicitly or use another name.',
          {
            status: 409,
            code: 'E_DEPLOY_PROJECT_NAME_TAKEN',
          }
        )
      }
    }
    return db.transaction(async (transaction) => {
      const target =
        (await ProjectDeployTarget.query({ client: transaction })
          .where('projectId', projectId)
          .forUpdate()
          .first()) ?? new ProjectDeployTarget()
      if (target.$isPersisted) {
        const active = await ProjectDeployment.query({ client: transaction })
          .where('targetId', target.id)
          .whereIn('status', [
            'packaging',
            'uploading_source',
            'transferring_to_vercel',
            'submitted',
            'building',
            'verifying_public_access',
            'canceling',
          ])
          .first()
        if (active) {
          throw new Exception('Wait for the active deployment before changing its target', {
            status: 409,
            code: 'E_DEPLOY_TARGET_BUSY',
          })
        }
      }
      target.useTransaction(transaction)
      target.merge({
        projectId,
        vercelConnectionId: input.connectionId,
        vercelProjectId: providerProjectId,
        vercelProjectName: providerProjectName,
        rootDirectory: manifest.rootDirectory,
        framework: manifest.framework,
        deploymentManifest: manifest,
        ...(target.$isPersisted ? {} : { productionUrl: null }),
      })
      await target.save()
      return target
    })
  }
}

export function serializeDeployTarget(target: ProjectDeployTarget) {
  return {
    id: target.id,
    projectId: target.projectId,
    connectionId: target.vercelConnectionId,
    providerProjectId: target.vercelProjectId,
    providerProjectName: target.vercelProjectName,
    rootDirectory: target.rootDirectory,
    framework: target.framework,
    productionUrl: target.productionUrl,
    manifest: target.deploymentManifest,
    createdAt: target.createdAt.toISO(),
    updatedAt: target.updatedAt?.toISO() ?? null,
  }
}

function normalizedProjectName(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 100)
  if (!normalized) {
    throw new Exception('Vercel project name is invalid', {
      status: 422,
      code: 'E_DEPLOY_PROJECT_NAME_INVALID',
    })
  }
  return normalized
}

function providerProjectUnavailable(): never {
  throw new Exception('The selected Vercel project is not accessible', {
    status: 422,
    code: 'E_DEPLOY_PROJECT_UNAVAILABLE',
  })
}
