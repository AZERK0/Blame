import type UserStory from '#models/user_story'
import UserStoryAgentRunTransformer from '#transformers/user_story_agent_run_transformer'
import UserStoryCommentTransformer from '#transformers/user_story_comment_transformer'
import { BaseTransformer } from '@adonisjs/core/transformers'

export default class UserStoryTransformer extends BaseTransformer<UserStory> {
  static summary(story: UserStory) {
    return {
      id: story.id,
      projectId: story.projectId,
      title: story.title,
      summary: story.summary,
      status: story.status,
      priority: story.priority,
      owner: story.owner,
      branch: story.branch,
      previewUrl: story.previewUrl,
      worktree: story.worktree,
      agentStatus: story.agentStatus,
      clineSessionId: story.clineSessionId,
      agentProviderId: story.agentProviderId,
      agentModelId: story.agentModelId,
      agentLastEvent: story.agentLastEvent,
      agentLastError: story.agentLastError,
      mergedAt: story.mergedAt,
      mergeCommit: story.mergeCommit,
      baseCommit: story.baseCommit,
      discardedReason: story.discardedReason,
      createdAt: story.createdAt,
      updatedAt: story.updatedAt,
    }
  }

  toObject() {
    return {
      ...this.pick(this.resource, [
        'id',
        'projectId',
        'title',
        'summary',
        'codeSelectionAttachments',
        'fileAttachments',
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
        'baseCommit',
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
