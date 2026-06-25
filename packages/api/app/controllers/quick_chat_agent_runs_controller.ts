import QuickChatsService from '#services/quick_chats_service'
import QuickChatAgentRunTransformer from '#transformers/quick_chat_agent_run_transformer'
import {
  createQuickChatAgentRunValidator,
  updateQuickChatAgentRunValidator,
} from '#validators/quick_chat_agent_run'
import type { HttpContext } from '@adonisjs/core/http'

export default class QuickChatAgentRunsController {
  async store({ auth, params, request, serialize }: HttpContext) {
    return serialize(
      QuickChatAgentRunTransformer.transform(
        await new QuickChatsService().createAgentRun(
          auth.getUserOrFail().id,
          params.id,
          await request.validateUsing(createQuickChatAgentRunValidator)
        )
      )
    )
  }

  async update({ auth, params, request, serialize }: HttpContext) {
    return serialize(
      QuickChatAgentRunTransformer.transform(
        await new QuickChatsService().updateAgentRun(
          auth.getUserOrFail().id,
          params.id,
          params.runId,
          await request.validateUsing(updateQuickChatAgentRunValidator)
        )
      )
    )
  }

  async activityDetail({ auth, params, response }: HttpContext) {
    try {
      return await new QuickChatsService().agentRunActivityDetail(
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
