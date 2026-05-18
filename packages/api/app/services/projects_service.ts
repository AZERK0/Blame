import Project from '#models/project'
import type { Infer } from '@vinejs/vine/types'
import type { ensureProjectValidator } from '#validators/project'

type EnsureProjectInput = Infer<typeof ensureProjectValidator>

export default class ProjectsService {
  async list(userId: number) {
    return Project.query().where('userId', userId).orderBy('updatedAt', 'desc')
  }

  async ensure(userId: number, input: EnsureProjectInput) {
    const existing = await this.findExistingProject(userId, input)

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

  private async findExistingProject(userId: number, input: EnsureProjectInput) {
    if (!input.repositoryFingerprint) {
      return undefined
    }

    const fingerprintMatch = await Project.query()
      .where('userId', userId)
      .where('repositoryFingerprint', input.repositoryFingerprint)
      .first()

    if (fingerprintMatch) {
      return fingerprintMatch
    }

    const legacyMatch = await Project.query()
      .where('userId', userId)
      .where('name', input.name)
      .whereNull('repositoryFingerprint')
      .first()

    if (!legacyMatch) {
      return undefined
    }

    legacyMatch.repositoryFingerprint = input.repositoryFingerprint
    await legacyMatch.save()
    return legacyMatch
  }

  async findForUser(userId: number, id: string) {
    return Project.query().where('userId', userId).where('id', id).firstOrFail()
  }
}
