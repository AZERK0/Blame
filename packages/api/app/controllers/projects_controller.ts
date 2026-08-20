import ProjectsService from '#services/projects_service'
import ProjectTransformer from '#transformers/project_transformer'
import { ensureProjectValidator } from '#validators/project'
import type { HttpContext } from '@adonisjs/core/http'

export default class ProjectsController {
  async index({ auth, serialize }: HttpContext) {
    const projects = await new ProjectsService().list(auth.getUserOrFail().id)
    return serialize(projects.map((project) => ProjectTransformer.transform(project)))
  }

  async store({ auth, request, serialize }: HttpContext) {
    return serialize(
      ProjectTransformer.transform(
        await new ProjectsService().ensure(
          auth.getUserOrFail().id,
          await request.validateUsing(ensureProjectValidator)
        )
      )
    )
  }
}
