import type QuickChat from '#models/quick_chat'
import QuickChatAgentRunTransformer from '#transformers/quick_chat_agent_run_transformer'
import QuickChatMessageTransformer from '#transformers/quick_chat_message_transformer'
import { BaseTransformer } from '@adonisjs/core/transformers'

export default class QuickChatTransformer extends BaseTransformer<QuickChat> {
  toObject() {
    return {
      ...this.pick(this.resource, [
        'id',
        'projectId',
        'title',
        'workspace',
        'agentStatus',
        'clineSessionId',
        'agentProviderId',
        'agentModelId',
        'agentLastEvent',
        'agentLastError',
        'agentActivities',
        'agentFinalResponse',
        'agentUsage',
        'agentSessionSummary',
        'createdAt',
        'updatedAt',
      ]),
      messages: (this.resource.messages ?? []).map((message) =>
        QuickChatMessageTransformer.transform(message)
      ),
      agentRuns: (this.resource.agentRuns ?? []).map((run) =>
        QuickChatAgentRunTransformer.transform(run)
      ),
    }
  }
}
