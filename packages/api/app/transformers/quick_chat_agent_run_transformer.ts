import type QuickChatAgentRun from '#models/quick_chat_agent_run'
import { BaseTransformer } from '@adonisjs/core/transformers'

export default class QuickChatAgentRunTransformer extends BaseTransformer<QuickChatAgentRun> {
  toObject() {
    return this.pick(this.resource, [
      'id',
      'quickChatId',
      'messageId',
      'kind',
      'clineSessionId',
      'checkpointRunCount',
      'diffEndRef',
      'status',
      'activities',
      'finalResponse',
      'usage',
      'sessionSummary',
      'completedAt',
      'createdAt',
      'updatedAt',
    ])
  }
}
