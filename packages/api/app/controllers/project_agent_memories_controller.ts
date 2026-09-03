import ProjectAgentMemoriesService from '#services/project_agent_memories_service'
import ProjectAgentMemoryTransformer from '#transformers/project_agent_memory_transformer'
import { storeProjectAgentMemoryValidator } from '#validators/project_agent_memory'
import type { HttpContext } from '@adonisjs/core/http'

export default class ProjectAgentMemoriesController {
  async index({ auth, params, serialize }: HttpContext) {
    const memories = await new ProjectAgentMemoriesService().list(
      auth.getUserOrFail().id,
      params.projectId
    )
    return serialize(memories.map((memory) => ProjectAgentMemoryTransformer.transform(memory)))
  }

  async store({ auth, params, request, serialize }: HttpContext) {
    const memory = await new ProjectAgentMemoriesService().store(
      auth.getUserOrFail().id,
      params.projectId,
      await request.validateUsing(storeProjectAgentMemoryValidator)
    )
    return serialize(ProjectAgentMemoryTransformer.transform(memory))
  }
}
