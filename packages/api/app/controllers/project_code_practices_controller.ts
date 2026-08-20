import ProjectCodePracticesService from '#services/project_code_practices_service'
import ProjectCodePracticeTransformer from '#transformers/project_code_practice_transformer'
import { updateProjectCodePracticeValidator } from '#validators/project_code_practice'
import type { HttpContext } from '@adonisjs/core/http'

export default class ProjectCodePracticesController {
  async index({ auth, params, serialize }: HttpContext) {
    const practices = await new ProjectCodePracticesService().list(
      auth.getUserOrFail().id,
      params.projectId
    )
    return serialize(
      practices.map((practice) => ProjectCodePracticeTransformer.transform(practice))
    )
  }

  async update({ auth, params, request, serialize }: HttpContext) {
    return serialize(
      ProjectCodePracticeTransformer.transform(
        await new ProjectCodePracticesService().update(
          auth.getUserOrFail().id,
          params.projectId,
          params.practice,
          await request.validateUsing(updateProjectCodePracticeValidator)
        )
      )
    )
  }
}
