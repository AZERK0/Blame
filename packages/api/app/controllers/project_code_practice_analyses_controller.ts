import ProjectCodePracticeAnalysesService from '#services/project_code_practice_analyses_service'
import ProjectCodePracticeAnalysisTransformer from '#transformers/project_code_practice_analysis_transformer'
import {
  completeProjectCodePracticeAnalysisValidator,
  failProjectCodePracticeAnalysisValidator,
  startProjectCodePracticeAnalysisValidator,
} from '#validators/project_code_practice_analysis'
import type { HttpContext } from '@adonisjs/core/http'

export default class ProjectCodePracticeAnalysesController {
  async show({ auth, params, serialize }: HttpContext) {
    return serialize(
      ProjectCodePracticeAnalysisTransformer.transform(
        await new ProjectCodePracticeAnalysesService().show(
          auth.getUserOrFail().id,
          params.projectId
        )
      )
    )
  }

  async start({ auth, params, request, serialize }: HttpContext) {
    return serialize(
      ProjectCodePracticeAnalysisTransformer.transform(
        await new ProjectCodePracticeAnalysesService().start(
          auth.getUserOrFail().id,
          params.projectId,
          await request.validateUsing(startProjectCodePracticeAnalysisValidator)
        )
      )
    )
  }

  async complete({ auth, params, request, serialize }: HttpContext) {
    return serialize(
      ProjectCodePracticeAnalysisTransformer.transform(
        await new ProjectCodePracticeAnalysesService().complete(
          auth.getUserOrFail().id,
          params.projectId,
          await request.validateUsing(completeProjectCodePracticeAnalysisValidator)
        )
      )
    )
  }

  async fail({ auth, params, request, serialize }: HttpContext) {
    return serialize(
      ProjectCodePracticeAnalysisTransformer.transform(
        await new ProjectCodePracticeAnalysesService().fail(
          auth.getUserOrFail().id,
          params.projectId,
          await request.validateUsing(failProjectCodePracticeAnalysisValidator)
        )
      )
    )
  }

  async viewed({ auth, params, serialize }: HttpContext) {
    return serialize(
      ProjectCodePracticeAnalysisTransformer.transform(
        await new ProjectCodePracticeAnalysesService().markViewed(
          auth.getUserOrFail().id,
          params.projectId
        )
      )
    )
  }
}
