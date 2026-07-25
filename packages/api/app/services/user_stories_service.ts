import Project from '#models/project'
import UserStory, { type UserStoryAgentActivity, type UserStoryStatus } from '#models/user_story'
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
import db from '@adonisjs/lucid/services/db'
import { Exception } from '@adonisjs/core/exceptions'
import FileAttachmentsService from '#services/file_attachments_service'
import type FileAttachment from '#models/file_attachment'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

type ListUserStoriesInput = Infer<typeof listUserStoriesValidator>
type CreateUserStoryInput = Infer<typeof createUserStoryValidator>
type UpdateUserStoryInput = Infer<typeof updateUserStoryValidator>
type CreateUserStoryCommentInput = Infer<typeof createUserStoryCommentValidator>
type CreateUserStoryAgentRunInput = Infer<typeof createUserStoryAgentRunValidator>
type UpdateUserStoryAgentRunInput = Infer<typeof updateUserStoryAgentRunValidator>

const maxAgentActivities = 80

export default class UserStoriesService {
  private fileAttachments = new FileAttachmentsService()

  async list(userId: string, input: ListUserStoriesInput) {
    await new ProjectsService().findForUser(userId, input.projectId)
    const query = UserStory.query().where('projectId', input.projectId).orderBy('createdAt', 'asc')
    if (input.view === 'summary') {
      return query.preload('agentRuns', (runs) =>
        runs.where('status', 'running').orderBy('createdAt', 'asc')
      )
    }
    const stories = await query
      .preload('storedFileAttachments')
      .preload('comments', (comments) => comments.preload('storedFileAttachments'))
      .preload('agentRuns', orderAgentRuns)
    stories.map(sortStoryComments)
    await this.prepareDownloads(stories)
    return stories
  }

  async find(userId: string, id: string) {
    const story = await this.userStoryQuery(userId)
      .where('id', id)
      .preload('storedFileAttachments')
      .preload('comments', (comments) => comments.preload('storedFileAttachments'))
      .preload('agentRuns', orderAgentRuns)
      .firstOrFail()
    sortStoryComments(story)
    await this.prepareDownloads([story])
    return story
  }

  async create(userId: string, input: CreateUserStoryInput) {
    if (input.projectId) {
      await new ProjectsService().findForUser(userId, input.projectId)
    }

    const attachments = await this.fileAttachments.resolveInputs(userId, input.fileAttachments)
    const storyNumber = await this.nextStoryNumber(input.projectId)
    const storyId = await db.transaction((transaction) =>
      this.createRecord(userId, input, storyNumber, attachments, transaction)
    )
    return this.find(userId, storyId)
  }

  async update(userId: string, id: string, input: UpdateUserStoryInput) {
    if (input.projectId) {
      await new ProjectsService().findForUser(userId, input.projectId)
    }

    const attachments =
      input.fileAttachments === undefined
        ? undefined
        : await this.fileAttachments.resolveInputs(userId, input.fileAttachments)
    await db.transaction(async (transaction) => {
      const userStory = await this.userStoryQuery(userId, transaction).where('id', id).firstOrFail()
      const update = await this.updateInput(userStory, input)
      userStory.useTransaction(transaction)
      userStory.merge({
        ...update,
        mergedAt: input.mergedAt === undefined ? userStory.mergedAt : input.mergedAt,
      })
      await userStory.save()
      if (attachments !== undefined) {
        await this.fileAttachments.syncOwner(
          userId,
          'userStory',
          userStory.id,
          attachments,
          transaction
        )
      }
    })
    return this.find(userId, id)
  }

  async createComment(userId: string, id: string, input: CreateUserStoryCommentInput) {
    await this.find(userId, id)
    const attachments = await this.fileAttachments.resolveInputs(userId, input.fileAttachments)
    const commentId = await db.transaction(async (transaction) => {
      const comment = await UserStoryComment.create(
        {
          author: 'Product',
          body: input.body,
          codeSelectionAttachments: input.codeSelectionAttachments ?? null,
          legacyFileAttachments: null,
          userStoryId: id,
        },
        { client: transaction }
      )
      await this.fileAttachments.syncOwner(
        userId,
        'userStoryComment',
        comment.id,
        attachments,
        transaction
      )
      return comment.id
    })
    return this.commentForDelivery(commentId)
  }

  async undoComment(
    userId: string,
    id: string,
    commentId: string,
    runId: string,
    clineSessionId?: string
  ) {
    await db.transaction(async (transaction) => {
      const story = await UserStory.query({ client: transaction })
        .whereIn(
          'projectId',
          Project.query({ client: transaction }).select('id').where('userId', userId)
        )
        .where('id', id)
        .preload('comments')
        .preload('agentRuns', orderAgentRuns)
        .forUpdate()
        .firstOrFail()
      sortStoryComments(story)
      const { comment, targetRun } = assertStoryUndoTarget(story, commentId, runId)
      const deletedCommentIds = new Set(
        story.comments.filter((item) => sameOrAfter(item, comment)).map((item) => item.id)
      )
      const deletedRunIds = new Set(
        story.agentRuns.slice(story.agentRuns.indexOf(targetRun)).map((run) => run.id)
      )
      await this.fileAttachments.markOwnersDetached(
        'userStoryComment',
        [...deletedCommentIds],
        transaction
      )
      await deleteStoryRuns(story.id, [...deletedRunIds], transaction)
      await deleteStoryComments(story.id, [...deletedCommentIds], transaction)
      const remainingRuns = story.agentRuns.filter((run) => !deletedRunIds.has(run.id))
      story.useTransaction(transaction)
      story.merge(storyUndoUpdate(remainingRuns, story.status, clineSessionId))
      await story.save()
    })
    return this.find(userId, id)
  }

  async validateCommentUndo(userId: string, id: string, commentId: string, runId: string) {
    assertStoryUndoTarget(await this.find(userId, id), commentId, runId)
  }

  async activityDetail(userId: string, id: string, activityId: string) {
    const story = await this.find(userId, id)
    const activity = story.agentActivities?.find((item) => item.id === activityId)
    if (!activity) throw new Error('Agent activity not found.')
    if (!activity.detailArtifact) return { detail: activity.detail }
    return { detail: await artifactDetail(story.worktree, activity) }
  }

  async createAgentRun(userId: string, id: string, input: CreateUserStoryAgentRunInput) {
    const story = await this.find(userId, id)
    if (input.commentId && !story.comments.some((comment) => comment.id === input.commentId)) {
      throw new Error('User story comment not found.')
    }
    return UserStoryAgentRun.create({
      activities: [],
      checkpointRunCount: input.checkpointRunCount ?? null,
      clineSessionId: input.clineSessionId ?? null,
      commentId: input.commentId ?? null,
      diffEndRef: null,
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
    id: string,
    runId: string,
    input: UpdateUserStoryAgentRunInput
  ) {
    const story = await this.find(userId, id)
    const run = await this.agentRunQuery(story, runId)
    const update = await this.agentRunUpdateInput(story, run, input)
    run.merge(update)
    await run.save()
    return run
  }

  async agentRunActivityDetail(userId: string, id: string, runId: string, activityId: string) {
    const story = await this.find(userId, id)
    const run = await this.agentRunQuery(story, runId)
    const activity = run.activities?.find((item) => item.id === activityId)
    if (!activity) throw new Error('Agent activity not found.')
    if (!activity.detailArtifact) return { detail: activity.detail }
    return { detail: await artifactDetail(story.worktree, activity) }
  }

  async delete(userId: string, id: string) {
    const userStory = await this.find(userId, id)
    await db.transaction(async (transaction) => {
      await this.fileAttachments.markOwnersDetached('userStory', [userStory.id], transaction)
      await this.fileAttachments.markOwnersDetached(
        'userStoryComment',
        userStory.comments.map((comment) => comment.id),
        transaction
      )
      userStory.useTransaction(transaction)
      await userStory.delete()
    })
  }

  private userStoryQuery(userId: string, client?: Parameters<UserStory['useTransaction']>[0]) {
    return UserStory.query({ client }).whereIn(
      'projectId',
      Project.query({ client }).select('id').where('userId', userId)
    )
  }

  private async updateInput(userStory: UserStory, input: UpdateUserStoryInput) {
    const { agentActivity, fileAttachments, ...update } = input
    void fileAttachments
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

  private async nextStoryNumber(projectId: string) {
    const latest = await UserStory.query()
      .where('projectId', projectId)
      .orderBy('storyNumber', 'desc')
      .first()
    return (latest?.storyNumber ?? 0) + 1
  }

  private async createRecord(
    userId: string,
    input: CreateUserStoryInput,
    storyNumber: number,
    attachments: FileAttachment[],
    transaction: TransactionClientContract
  ) {
    const userStory = await UserStory.create(userStoryCreateAttributes(input, storyNumber), {
      client: transaction,
    })
    await this.fileAttachments.syncOwner(
      userId,
      'userStory',
      userStory.id,
      attachments,
      transaction
    )
    return userStory.id
  }

  private async commentForDelivery(id: string) {
    const comment = await UserStoryComment.query()
      .where('id', id)
      .preload('storedFileAttachments')
      .firstOrFail()
    await this.fileAttachments.prepareDownloads(storedAttachments(comment))
    return comment
  }

  private async prepareDownloads(stories: UserStory[]) {
    const attachments = stories.flatMap((story) => [
      ...storedAttachments(story),
      ...story.comments.flatMap(storedAttachments),
    ])
    await this.fileAttachments.prepareDownloads(uniqueAttachments(attachments))
  }

  private agentRunQuery(story: UserStory, runId: string) {
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

function storedAttachments(owner: UserStory | UserStoryComment): FileAttachment[] {
  return (owner.$preloaded.storedFileAttachments as FileAttachment[] | undefined) ?? []
}

function uniqueAttachments(attachments: FileAttachment[]) {
  return [...new Map(attachments.map((attachment) => [attachment.id, attachment])).values()]
}

function userStoryCreateAttributes(input: CreateUserStoryInput, storyNumber: number) {
  const { agentActivity, fileAttachments, fileAttachmentUploadPending, ...attributes } = input
  void agentActivity
  void fileAttachments
  return {
    ...attributes,
    ...nullableStoryAttributes(input),
    codeSelectionAttachments: input.codeSelectionAttachments ?? null,
    fileAttachmentUploadPending: fileAttachmentUploadPending ?? false,
    legacyFileAttachments: null,
    owner: input.owner ?? 'Product',
    priority: input.priority ?? 'Medium',
    status: input.status ?? 'backlog',
    storyNumber,
  }
}

function nullableStoryAttributes(input: CreateUserStoryInput) {
  return {
    agentActivities: input.agentActivities ?? null,
    agentFinalResponse: input.agentFinalResponse ?? null,
    agentLastError: input.agentLastError ?? null,
    agentLastEvent: input.agentLastEvent ?? null,
    agentModelId: input.agentModelId ?? null,
    agentProviderId: input.agentProviderId ?? null,
    agentSessionSummary: input.agentSessionSummary ?? null,
    agentStatus: input.agentStatus ?? null,
    agentUsage: input.agentUsage ?? null,
    baseCommit: input.baseCommit ?? null,
    branch: input.branch ?? null,
    clineSessionId: input.clineSessionId ?? null,
    discardedReason: input.discardedReason ?? null,
    mergeCommit: input.mergeCommit ?? null,
    mergedAt: input.mergedAt ?? null,
    previewUrl: input.previewUrl ?? null,
    runConfigurationId: input.runConfigurationId ?? null,
    worktree: input.worktree ?? null,
  }
}

function assertStoryUndoTarget(story: UserStory, commentId: string, runId: string) {
  const comment = story.comments.find((item) => item.id === commentId)
  if (!comment) throw new Error('User story comment not found.')
  const targetRun = story.agentRuns.find((run) => run.id === runId)
  if (!targetRun || targetRun.commentId !== comment.id) {
    throw new Exception('Agent run does not belong to this user story comment.', {
      code: 'E_USER_STORY_UNDO_RUN_MISMATCH',
      status: 409,
    })
  }
  return { comment, targetRun }
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
  return createdAtDelta || left.id.localeCompare(right.id)
}

async function deleteStoryRuns(
  storyId: string,
  ids: string[],
  client?: Parameters<UserStoryAgentRun['useTransaction']>[0]
) {
  if (!ids.length) return
  await UserStoryAgentRun.query({ client })
    .where('userStoryId', storyId)
    .whereIn('id', ids)
    .delete()
}

async function deleteStoryComments(
  storyId: string,
  ids: string[],
  client?: Parameters<UserStoryComment['useTransaction']>[0]
) {
  if (!ids.length) return
  await UserStoryComment.query({ client }).where('userStoryId', storyId).whereIn('id', ids).delete()
}

function storyUndoUpdate(
  remainingRuns: UserStoryAgentRun[],
  currentStatus: UserStoryStatus,
  clineSessionId?: string
): Partial<UserStory> {
  const lastRun = remainingRuns.at(-1)
  return {
    agentActivities: lastRun?.activities ?? [],
    agentFinalResponse: lastRun?.finalResponse ?? null,
    agentLastError: null,
    agentLastEvent: lastRun ? agentRunLastEvent(lastRun) : null,
    agentSessionSummary: lastRun?.sessionSummary ?? null,
    agentStatus: null,
    agentUsage: lastRun?.usage ?? null,
    clineSessionId: clineSessionId ?? lastRun?.clineSessionId ?? null,
    status: storyStatusAfterUndo(lastRun, currentStatus),
  }
}

function storyStatusAfterUndo(
  lastRun: UserStoryAgentRun | undefined,
  currentStatus: UserStoryStatus
): UserStoryStatus {
  if (!lastRun) return 'backlog'
  if (lastRun.status === 'running') return 'in-progress'
  if (currentStatus === 'done') return 'in-review'
  if (currentStatus === 'discarded') return 'backlog'
  if (currentStatus === 'backlog' || currentStatus === 'ready') return currentStatus
  return 'in-review'
}

function agentRunLastEvent(run: UserStoryAgentRun) {
  if (run.status === 'failed') return run.finalResponse ?? 'Agent run failed.'
  if (run.status === 'running') return 'Agent is running.'
  return run.finalResponse ?? 'Agent run completed.'
}

function sameOrAfter<T extends { createdAt: DateTime; id: string }>(item: T, target: T) {
  const delta = item.createdAt.toMillis() - target.createdAt.toMillis()
  return delta > 0 || (delta === 0 && item.id.localeCompare(target.id) >= 0)
}
