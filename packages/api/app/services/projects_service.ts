import Project from '#models/project'
import type { Infer } from '@vinejs/vine/types'
import type { ensureProjectValidator } from '#validators/project'

type EnsureProjectInput = Infer<typeof ensureProjectValidator>

export default class ProjectsService {
  async list(userId: number) {
    return Project.query().where('userId', userId).orderBy('updatedAt', 'desc')
  }

  async ensure(userId: number, input: EnsureProjectInput) {
    const existing = input.repositoryFingerprint
      ? await Project.query()
          .where('userId', userId)
          .where('repositoryFingerprint', input.repositoryFingerprint)
          .first()
      : undefined

    if (!existing) {
      return Project.create({
        id: crypto.randomUUID(),
        name: input.name,
        repositoryFingerprint: input.repositoryFingerprint ?? null,
        userId,
      })
    }

    existing.merge({ name: input.name })
    await existing.save()
    return existing
  }

  async findForUser(userId: number, id: string) {
    return Project.query().where('userId', userId).where('id', id).firstOrFail()
  }
}
