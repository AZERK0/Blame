import type UserStoryAgentRun from '#models/user_story_agent_run'
import { BaseTransformer } from '@adonisjs/core/transformers'

export default class UserStoryAgentRunTransformer extends BaseTransformer<UserStoryAgentRun> {
  toObject() {
    return this.pick(this.resource, [
      'id',
      'userStoryId',
      'commentId',
      'kind',
      'clineSessionId',
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
