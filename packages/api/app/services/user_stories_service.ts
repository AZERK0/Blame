import Project from '#models/project'
import UserStory, { type UserStoryAgentActivity } from '#models/user_story'
import UserStoryComment from '#models/user_story_comment'
import ProjectsService from '#services/projects_service'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { Infer } from '@vinejs/vine/types'
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

const maxAgentActivities = 80
const maxPersistedDetailLength = 4096

export default class UserStoriesService {
  async list(userId: number, input: ListUserStoriesInput) {
    await new ProjectsService().findForUser(userId, input.projectId)
    return UserStory.query()
      .where('projectId', input.projectId)
      .preload('comments', (comments) => comments.orderBy('createdAt', 'asc').orderBy('id', 'asc'))
      .orderBy('createdAt', 'asc')
  }

  async find(userId: number, id: number) {
    return this.userStoryQuery(userId)
      .where('id', id)
      .preload('comments', (comments) => comments.orderBy('createdAt', 'asc').orderBy('id', 'asc'))
      .firstOrFail()
  }

  async create(userId: number, input: CreateUserStoryInput) {
    if (input.projectId) {
      await new ProjectsService().findForUser(userId, input.projectId)
    }

    const userStory = await UserStory.create({
      projectId: input.projectId,
      title: input.title,
      summary: input.summary,
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
      discardedReason: input.discardedReason ?? null,
    })
    await userStory.load('comments')
    return userStory
  }

  async update(userId: number, id: number, input: UpdateUserStoryInput) {
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
    await userStory.load('comments', (comments) =>
      comments.orderBy('createdAt', 'asc').orderBy('id', 'asc')
    )
    return userStory
  }

  async createComment(userId: number, id: number, input: CreateUserStoryCommentInput) {
    await this.find(userId, id)
    return UserStoryComment.create({
      author: 'Product',
      body: input.body,
      userStoryId: id,
    })
  }

  async activityDetail(userId: number, id: number, activityId: string) {
    const story = await this.find(userId, id)
    const activity = story.agentActivities?.find((item) => item.id === activityId)
    if (!activity) throw new Error('Agent activity not found.')
    if (!activity.detailArtifact) return { detail: activity.detail }
    return { detail: await artifactDetail(story, activity) }
  }

  async delete(userId: number, id: number) {
    const userStory = await this.find(userId, id)
    await userStory.delete()
  }

  private userStoryQuery(userId: number) {
    return UserStory.query().whereIn(
      'projectId',
      Project.query().select('id').where('userId', userId)
    )
  }

  private async updateInput(userStory: UserStory, input: UpdateUserStoryInput) {
    const { agentActivity, ...update } = input
    if (!agentActivity) return update
    const activity = await activityWithArtifact(userStory, agentActivity)
    return {
      ...update,
      agentActivities: upsertActivity(userStory.agentActivities ?? [], activity),
    }
  }
}

async function activityWithArtifact(
  story: UserStory,
  activity: UserStoryAgentActivity
): Promise<UserStoryAgentActivity> {
  if (!story.worktree || activity.detail.length <= maxPersistedDetailLength) return activity
  const artifact = await writeActivityArtifact(story, activity)
  return {
    ...activity,
    detail: middleExcerpt(activity.detail, maxPersistedDetailLength),
    detailArtifact: artifact,
    detailTruncated: true,
    originalDetailLength: activity.detail.length,
  }
}

async function writeActivityArtifact(story: UserStory, activity: UserStoryAgentActivity) {
  const session = safeFilename(story.clineSessionId ?? 'unknown-session')
  const directory = join(story.worktree!, '.blame', 'artifacts', 'agent-activities', session)
  await mkdir(directory, { recursive: true })
  const filename = `${safeFilename(activity.id)}.json`
  const path = join(directory, filename)
  await writeFile(path, JSON.stringify(activity, null, 2))
  return path
}

function upsertActivity(activities: UserStoryAgentActivity[], input: UserStoryAgentActivity) {
  const exists = activities.some((activity) => activity.id === input.id)
  const next = exists
    ? activities.map((activity) => (activity.id === input.id ? input : activity))
    : [...activities, input]
  return next.slice(Math.max(0, next.length - maxAgentActivities))
}

function middleExcerpt(value: string, length: number) {
  if (value.length <= length) return value
  const edgeLength = Math.floor((length - 20) / 2)
  return `${value.slice(0, edgeLength)}\n...\n${value.slice(-edgeLength)}`
}

function safeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 160)
}

async function artifactDetail(story: UserStory, activity: UserStoryAgentActivity) {
  const path = activity.detailArtifact
  if (!path || !story.worktree || !isAbsolute(path)) return activity.detail
  if (!isPathInside(resolve(path), resolve(story.worktree))) return activity.detail
  try {
    const artifact = JSON.parse(await readFile(path, 'utf8')) as UserStoryAgentActivity
    return typeof artifact.detail === 'string' ? artifact.detail : activity.detail
  } catch {
    return activity.detail
  }
}

function isPathInside(path: string, root: string) {
  return path === root || path.startsWith(`${root}/`)
}
