import type UserStory from '#models/user_story'
import UserStoryAgentRunTransformer from '#transformers/user_story_agent_run_transformer'
import UserStoryCommentTransformer from '#transformers/user_story_comment_transformer'
import { BaseTransformer } from '@adonisjs/core/transformers'

export default class UserStoryTransformer extends BaseTransformer<UserStory> {
  toObject() {
    return {
      ...this.pick(this.resource, [
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
        'agentActivities',
        'agentFinalResponse',
        'agentUsage',
        'agentSessionSummary',
        'mergedAt',
        'mergeCommit',
        'discardedReason',
        'createdAt',
        'updatedAt',
      ]),
      comments: (this.resource.comments ?? []).map((comment) =>
        UserStoryCommentTransformer.transform(comment)
      ),
      agentRuns: (this.resource.agentRuns ?? []).map((run) =>
        UserStoryAgentRunTransformer.transform(run)
      ),
    }
  }
}
