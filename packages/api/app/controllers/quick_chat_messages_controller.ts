import { optionalClineSessionId } from '#lib/optional_cline_session_id'
import QuickChatsService from '#services/quick_chats_service'
import QuickChatTransformer from '#transformers/quick_chat_transformer'
import QuickChatMessageTransformer from '#transformers/quick_chat_message_transformer'
import { createQuickChatMessageValidator } from '#validators/quick_chat'
import type { HttpContext } from '@adonisjs/core/http'

export default class QuickChatMessagesController {
  async store({ auth, params, request, serialize }: HttpContext) {
    return serialize(
      QuickChatMessageTransformer.transform(
        await new QuickChatsService().createMessage(
          auth.getUserOrFail().id,
          params.id,
          await request.validateUsing(createQuickChatMessageValidator)
        )
      )
    )
  }

  async undo({ auth, params, request, serialize }: HttpContext) {
    return serialize(
      QuickChatTransformer.transform(
        await new QuickChatsService().undoMessage(
          auth.getUserOrFail().id,
          params.id,
          params.messageId,
          optionalClineSessionId(request.input('clineSessionId'))
        )
      )
    )
  }
}
