import DeployTargetsService, {
  serializeDeployTarget,
} from '#services/deployments/deploy_targets_service'
import { updateDeployTargetValidator } from '#validators/deployment'
import type { HttpContext } from '@adonisjs/core/http'

export default class DeployTargetsController {
  async show({ auth, params }: HttpContext) {
    const target = await new DeployTargetsService().show(auth.getUserOrFail().id, params.projectId)
    return { target: target ? serializeDeployTarget(target) : null }
  }

  async update({ auth, params, request }: HttpContext) {
    const target = await new DeployTargetsService().update(
      auth.getUserOrFail().id,
      params.projectId,
      await request.validateUsing(updateDeployTargetValidator)
    )
    return { target: serializeDeployTarget(target) }
  }
}
