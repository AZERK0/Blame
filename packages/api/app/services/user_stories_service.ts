import Project from '#models/project'
import UserStory, { type UserStoryAgentActivity } from '#models/user_story'
import UserStoryAgentRun from '#models/user_story_agent_run'
import UserStoryComment from '#models/user_story_comment'
import { activityWithArtifact, artifactDetail } from '#services/agent_activity_artifacts'
import ProjectsService from '#services/projects_service'
import { DateTime } from 'luxon'
import type { Infer } from '@vinejs/vine/types'
import type {
  createUserStoryAgentRunValidator,
  updateUserStoryAgentRunValidator,
} from '#validators/user_story_agent_run'
import type {
  createUserStoryValidator,
  listUserStoriesValidator,
  updateUserStoryValidator,
} from '#validators/user_story'
import type { createUserStoryCommentValidator } from '#validators/user_story_comment'

type ListUserStoriesInput = Infer<typeof listUserStoriesValidator>
type CreateUserStoryInput = Infer<typeof createUserStoryValidator>
type UpdateUserStoryInput = Infer<typeof updateUserStoryValidator>
type CreateUserStoryCommentInput = Infer<typeof createUserStoryCommentValidator>
type CreateUserStoryAgentRunInput = Infer<typeof createUserStoryAgentRunValidator>
type UpdateUserStoryAgentRunInput = Infer<typeof updateUserStoryAgentRunValidator>

const maxAgentActivities = 80

export default class UserStoriesService {
  async list(userId: string, input: ListUserStoriesInput) {
    await new ProjectsService().findForUser(userId, input.projectId)
    const query = UserStory.query().where('projectId', input.projectId).orderBy('createdAt', 'asc')
    if (input.view === 'summary') return query
    const stories = await query.preload('comments').preload('agentRuns', orderAgentRuns)
    return stories.map(sortStoryComments)
  }

  async find(userId: string, id: number) {
    const story = await this.userStoryQuery(userId)
      .where('id', id)
      .preload('comments')
      .preload('agentRuns', orderAgentRuns)
      .firstOrFail()
    return sortStoryComments(story)
  }

  async create(userId: string, input: CreateUserStoryInput) {
    if (input.projectId) {
      await new ProjectsService().findForUser(userId, input.projectId)
    }

    const userStory = await UserStory.create({
      projectId: input.projectId,
      title: input.title,
      summary: input.summary,
      codeSelectionAttachments: input.codeSelectionAttachments ?? null,
      fileAttachments: input.fileAttachments ?? null,
      status: input.status ?? 'backlog',
      priority: input.priority ?? 'Medium',
      owner: input.owner ?? 'Product',
      branch: input.branch ?? null,
      previewUrl: input.previewUrl ?? null,
      worktree: input.worktree ?? null,
      agentStatus: input.agentStatus ?? null,
      clineSessionId: input.clineSessionId ?? null,
      agentProviderId: input.agentProviderId ?? null,
      agentModelId: input.agentModelId ?? null,
      agentLastEvent: input.agentLastEvent ?? null,
      agentLastError: input.agentLastError ?? null,
      agentActivities: input.agentActivities ?? null,
      agentFinalResponse: input.agentFinalResponse ?? null,
      agentUsage: input.agentUsage ?? null,
      agentSessionSummary: input.agentSessionSummary ?? null,
      mergedAt: input.mergedAt ?? null,
      mergeCommit: input.mergeCommit ?? null,
      baseCommit: input.baseCommit ?? null,
      discardedReason: input.discardedReason ?? null,
    })
    await userStory.load('comments')
    await userStory.load('agentRuns')
    return userStory
  }

  async update(userId: string, id: number, input: UpdateUserStoryInput) {
    if (input.projectId) {
      await new ProjectsService().findForUser(userId, input.projectId)
    }

    const userStory = await this.find(userId, id)
    const update = await this.updateInput(userStory, input)
    userStory.merge({
      ...update,
      mergedAt: input.mergedAt === undefined ? userStory.mergedAt : input.mergedAt,
    })
    await userStory.save()
    await userStory.load('comments')
    sortStoryComments(userStory)
    await userStory.load('agentRuns', orderAgentRuns)
    return userStory
  }

  async createComment(userId: string, id: number, input: CreateUserStoryCommentInput) {
    await this.find(userId, id)
    return UserStoryComment.create({
      author: 'Product',
      body: input.body,
      codeSelectionAttachments: input.codeSelectionAttachments ?? null,
      fileAttachments: input.fileAttachments ?? null,
      userStoryId: id,
    })
  }

  async activityDetail(userId: string, id: number, activityId: string) {
    const story = await this.find(userId, id)
    const activity = story.agentActivities?.find((item) => item.id === activityId)
    if (!activity) throw new Error('Agent activity not found.')
    if (!activity.detailArtifact) return { detail: activity.detail }
    return { detail: await artifactDetail(story.worktree, activity) }
  }

  async createAgentRun(userId: string, id: number, input: CreateUserStoryAgentRunInput) {
    const story = await this.find(userId, id)
    if (input.commentId && !story.comments.some((comment) => comment.id === input.commentId)) {
      throw new Error('User story comment not found.')
    }
    return UserStoryAgentRun.create({
      activities: [],
      clineSessionId: input.clineSessionId ?? null,
      commentId: input.commentId ?? null,
      finalResponse: null,
      kind: input.kind,
      sessionSummary: null,
      status: input.status ?? 'running',
      usage: null,
      userStoryId: story.id,
    })
  }

  async updateAgentRun(
    userId: string,
    id: number,
    runId: number,
    input: UpdateUserStoryAgentRunInput
  ) {
    const story = await this.find(userId, id)
    const run = await this.agentRunQuery(story, runId)
    const update = await this.agentRunUpdateInput(story, run, input)
    run.merge(update)
    await run.save()
    return run
  }

  async agentRunActivityDetail(userId: string, id: number, runId: number, activityId: string) {
    const story = await this.find(userId, id)
    const run = await this.agentRunQuery(story, runId)
    const activity = run.activities?.find((item) => item.id === activityId)
    if (!activity) throw new Error('Agent activity not found.')
    if (!activity.detailArtifact) return { detail: activity.detail }
    return { detail: await artifactDetail(story.worktree, activity) }
  }

  async delete(userId: string, id: number) {
    const userStory = await this.find(userId, id)
    await userStory.delete()
  }

  private userStoryQuery(userId: string) {
    return UserStory.query().whereIn(
      'projectId',
      Project.query().select('id').where('userId', userId)
    )
  }

  private async updateInput(userStory: UserStory, input: UpdateUserStoryInput) {
    const { agentActivity, ...update } = input
    if (!agentActivity) return update
    const activity = await activityWithArtifact(
      userStory.worktree,
      userStory.clineSessionId,
      agentActivity
    )
    return {
      ...update,
      agentActivities: upsertActivity(userStory.agentActivities ?? [], activity),
    }
  }

  private agentRunQuery(story: UserStory, runId: number) {
    return UserStoryAgentRun.query().where('userStoryId', story.id).where('id', runId).firstOrFail()
  }

  private async agentRunUpdateInput(
    story: UserStory,
    run: UserStoryAgentRun,
    input: UpdateUserStoryAgentRunInput
  ) {
    const { agentActivity, ...update } = input
    const nextUpdate = {
      ...update,
      ...agentRunCompletedAtUpdate(update),
    }
    if (!agentActivity) return nextUpdate
    const activity = await activityWithArtifact(story.worktree, run.clineSessionId, agentActivity)
    return {
      ...nextUpdate,
      activities: upsertActivity(run.activities ?? [], activity),
    }
  }
}

function upsertActivity(activities: UserStoryAgentActivity[], input: UserStoryAgentActivity) {
  const exists = activities.some((activity) => activity.id === input.id)
  const next = exists
    ? activities.map((activity) => (activity.id === input.id ? input : activity))
    : [...activities, input]
  return next.slice(Math.max(0, next.length - maxAgentActivities))
}

function terminalStatus(status: string | undefined) {
  return status === 'completed' || status === 'failed'
}

function agentRunCompletedAtUpdate(input: { completedAt?: DateTime | null; status?: string }) {
  if (input.completedAt !== undefined) return { completedAt: input.completedAt }
  if (terminalStatus(input.status)) return { completedAt: DateTime.now() }
  return {}
}

function orderAgentRuns(query: ReturnType<typeof UserStoryAgentRun.query>) {
  query.orderBy('userStoryId', 'asc').orderBy('createdAt', 'asc').orderBy('id', 'asc')
}

function sortStoryComments<T extends UserStory>(story: T) {
  story.comments?.sort(compareComments)
  return story
}

function compareComments(left: UserStoryComment, right: UserStoryComment) {
  const createdAtDelta = left.createdAt.toMillis() - right.createdAt.toMillis()
  return createdAtDelta || left.id - right.id
}
