import Project from '#models/project'
import UserStory from '#models/user_story'
import UserStoryComment from '#models/user_story_comment'
import ProjectsService from '#services/projects_service'
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
    userStory.merge({
      ...input,
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
}
