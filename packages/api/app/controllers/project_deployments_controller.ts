import ProjectDeploymentsService, {
  serializeProjectDeployment,
} from '#services/deployments/project_deployments_service'
import {
  completeDeploymentSourceValidator,
  createDeploymentValidator,
} from '#validators/deployment'
import type { HttpContext } from '@adonisjs/core/http'

export default class ProjectDeploymentsController {
  async index({ auth, params }: HttpContext) {
    const deployments = await new ProjectDeploymentsService().list(
      auth.getUserOrFail().id,
      params.projectId
    )
    return { deployments: deployments.map(serializeProjectDeployment) }
  }

  async store({ auth, params, request }: HttpContext) {
    return new ProjectDeploymentsService().create(
      auth.getUserOrFail().id,
      params.projectId,
      await request.validateUsing(createDeploymentValidator)
    )
  }

  async show({ auth, params }: HttpContext) {
    const deployment = await new ProjectDeploymentsService().show(
      auth.getUserOrFail().id,
      params.projectId,
      params.id
    )
    return { deployment: serializeProjectDeployment(deployment) }
  }

  async completeSource({ auth, params, request }: HttpContext) {
    const deployment = await new ProjectDeploymentsService().complete(
      auth.getUserOrFail().id,
      params.projectId,
      params.id,
      await request.validateUsing(completeDeploymentSourceValidator)
    )
    return { deployment: serializeProjectDeployment(deployment) }
  }

  async cancel({ auth, params }: HttpContext) {
    const deployment = await new ProjectDeploymentsService().cancel(
      auth.getUserOrFail().id,
      params.projectId,
      params.id
    )
    return { deployment: serializeProjectDeployment(deployment) }
  }

  async logs({ auth, params }: HttpContext) {
    return {
      logs: await new ProjectDeploymentsService().logs(
        auth.getUserOrFail().id,
        params.projectId,
        params.id
      ),
    }
  }
}
