import ProjectAgentMemory from '#models/project_agent_memory'
import ProjectsService from '#services/projects_service'
import type { storeProjectAgentMemoryValidator } from '#validators/project_agent_memory'
import type { Infer } from '@vinejs/vine/types'
import { Exception } from '@adonisjs/core/exceptions'
import { createHash } from 'node:crypto'

type StoreMemoryInput = Infer<typeof storeProjectAgentMemoryValidator>
const maximumProjectMemories = 64

export default class ProjectAgentMemoriesService {
  async list(userId: string, projectId: string) {
    await new ProjectsService().findForUser(userId, projectId)
    return ProjectAgentMemory.query()
      .where('projectId', projectId)
      .orderBy('createdAt', 'desc')
      .limit(maximumProjectMemories)
  }

  async store(userId: string, projectId: string, input: StoreMemoryInput) {
    await new ProjectsService().findForUser(userId, projectId)
    assertFingerprint(input)
    const memory = await ProjectAgentMemory.firstOrCreate(
      { fingerprint: input.fingerprint, projectId },
      { ...input, projectId }
    )
    await this.prune(projectId)
    return memory
  }

  private async prune(projectId: string) {
    const obsolete = await ProjectAgentMemory.query()
      .where('projectId', projectId)
      .orderBy('createdAt', 'desc')
      .offset(maximumProjectMemories)
      .select('id')
    if (!obsolete.length) return
    await ProjectAgentMemory.query()
      .whereIn(
        'id',
        obsolete.map(({ id }) => id)
      )
      .delete()
  }
}

function assertFingerprint(input: StoreMemoryInput) {
  const candidate = {
    files: input.files,
    objective: input.objective,
    sourceRevisionId: input.sourceRevisionId,
    ...(input.storyId ? { storyId: input.storyId } : {}),
    summary: input.summary,
    symbols: input.symbols,
    ...(input.validationKind ? { validationKind: input.validationKind } : {}),
    ...(input.validationTaskId ? { validationTaskId: input.validationTaskId } : {}),
  }
  const expected = createHash('sha256').update(JSON.stringify(candidate)).digest('hex')
  if (input.fingerprint === expected) return
  throw new Exception('Project memory fingerprint is invalid', {
    code: 'E_PROJECT_AGENT_MEMORY_FINGERPRINT',
    status: 422,
  })
}
