import UserStoriesService from '#services/user_stories_service'
import UserStoryAgentRunTransformer from '#transformers/user_story_agent_run_transformer'
import {
  createUserStoryAgentRunValidator,
  updateUserStoryAgentRunValidator,
} from '#validators/user_story_agent_run'
import type { HttpContext } from '@adonisjs/core/http'

export default class UserStoryAgentRunsController {
  async store({ auth, params, request, serialize }: HttpContext) {
    return serialize(
      UserStoryAgentRunTransformer.transform(
        await new UserStoriesService().createAgentRun(
          auth.getUserOrFail().id,
          params.id,
          await request.validateUsing(createUserStoryAgentRunValidator)
        )
      )
    )
  }

  async update({ auth, params, request, serialize }: HttpContext) {
    return serialize(
      UserStoryAgentRunTransformer.transform(
        await new UserStoriesService().updateAgentRun(
          auth.getUserOrFail().id,
          params.id,
          params.runId,
          await request.validateUsing(updateUserStoryAgentRunValidator)
        )
      )
    )
  }

  async activityDetail({ auth, params, response }: HttpContext) {
    try {
      return await new UserStoriesService().agentRunActivityDetail(
        auth.getUserOrFail().id,
        params.id,
        params.runId,
        params.activityId
      )
    } catch {
      return response.notFound({ message: 'Agent activity not found.' })
    }
  }
}
