import type UserStoryAgentRun from '#models/user_story_agent_run'
import { BaseTransformer } from '@adonisjs/core/transformers'

export default class UserStoryAgentRunTransformer extends BaseTransformer<UserStoryAgentRun> {
  static summary(run: UserStoryAgentRun) {
    return {
      id: run.id,
      userStoryId: run.userStoryId,
      commentId: run.commentId,
      kind: run.kind,
      clineSessionId: run.clineSessionId,
      checkpointRunCount: run.checkpointRunCount,
      diffEndRef: run.diffEndRef,
      status: run.status,
      completedAt: run.completedAt,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    }
  }

  toObject() {
    return this.pick(this.resource, [
      'id',
      'userStoryId',
      'commentId',
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
