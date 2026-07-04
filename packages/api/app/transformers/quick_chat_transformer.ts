import type QuickChat from '#models/quick_chat'
import QuickChatAgentRunTransformer from '#transformers/quick_chat_agent_run_transformer'
import QuickChatMessageTransformer from '#transformers/quick_chat_message_transformer'
import { BaseTransformer } from '@adonisjs/core/transformers'

export default class QuickChatTransformer extends BaseTransformer<QuickChat> {
  static summary(quickChat: QuickChat) {
    return {
      id: quickChat.id,
      projectId: quickChat.projectId,
      title: quickChat.title,
      workspace: quickChat.workspace,
      agentStatus: quickChat.agentStatus,
      clineSessionId: quickChat.clineSessionId,
      agentProviderId: quickChat.agentProviderId,
      agentModelId: quickChat.agentModelId,
      agentLastEvent: quickChat.agentLastEvent,
      agentLastError: quickChat.agentLastError,
      preview: quickChat.agentLastError ?? quickChat.agentLastEvent,
      createdAt: quickChat.createdAt,
      updatedAt: quickChat.updatedAt,
    }
  }

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
