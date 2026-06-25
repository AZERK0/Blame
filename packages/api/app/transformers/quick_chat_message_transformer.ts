import type QuickChatMessage from '#models/quick_chat_message'
import { BaseTransformer } from '@adonisjs/core/transformers'

export default class QuickChatMessageTransformer extends BaseTransformer<QuickChatMessage> {
  toObject() {
    return this.pick(this.resource, [
      'id',
      'quickChatId',
      'body',
      'codeSelectionAttachments',
      'fileAttachments',
      'author',
      'createdAt',
      'updatedAt',
    ])
  }
}
