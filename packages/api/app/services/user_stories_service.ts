import Project from '#models/project'
import UserStory from '#models/user_story'
import ProjectsService from '#services/projects_service'
import type { Infer } from '@vinejs/vine/types'
import type {
  createUserStoryValidator,
  listUserStoriesValidator,
  updateUserStoryValidator,
} from '#validators/user_story'

type ListUserStoriesInput = Infer<typeof listUserStoriesValidator>
type CreateUserStoryInput = Infer<typeof createUserStoryValidator>
type UpdateUserStoryInput = Infer<typeof updateUserStoryValidator>

export default class UserStoriesService {
  async list(userId: number, input: ListUserStoriesInput) {
    await new ProjectsService().findForUser(userId, input.projectId)
    return UserStory.query().where('projectId', input.projectId).orderBy('createdAt', 'asc')
  }

  async find(userId: number, id: number) {
    return this.userStoryQuery(userId).where('id', id).firstOrFail()
  }

  async create(userId: number, input: CreateUserStoryInput) {
    if (input.projectId) {
      await new ProjectsService().findForUser(userId, input.projectId)
    }

    return UserStory.create({
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
      mergedAt: input.mergedAt ?? null,
      mergeCommit: input.mergeCommit ?? null,
      discardedReason: input.discardedReason ?? null,
    })
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
    return userStory
  }

  async delete(userId: number, id: number) {
    const userStory = await this.find(userId, id)
    await userStory.delete()
  }

  private userStoryQuery(userId: number) {
    return UserStory.query().whereIn('projectId', Project.query().select('id').where('userId', userId))
  }
}
