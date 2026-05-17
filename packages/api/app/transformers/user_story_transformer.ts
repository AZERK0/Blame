import type UserStory from '#models/user_story'
import { BaseTransformer } from '@adonisjs/core/transformers'

export default class UserStoryTransformer extends BaseTransformer<UserStory> {
  toObject() {
    return this.pick(this.resource, [
      'id',
      'projectId',
      'title',
      'summary',
      'status',
      'priority',
      'owner',
      'branch',
      'previewUrl',
      'worktree',
      'agentStatus',
      'clineSessionId',
      'agentProviderId',
      'agentModelId',
      'agentLastEvent',
      'agentLastError',
      'mergedAt',
      'mergeCommit',
      'discardedReason',
      'createdAt',
      'updatedAt',
    ])
  }
}
