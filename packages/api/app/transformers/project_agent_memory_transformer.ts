import type ProjectAgentMemory from '#models/project_agent_memory'
import { BaseTransformer } from '@adonisjs/core/transformers'

export default class ProjectAgentMemoryTransformer extends BaseTransformer<ProjectAgentMemory> {
  toObject() {
    return {
      id: this.resource.id,
      projectId: this.resource.projectId,
      fingerprint: this.resource.fingerprint,
      objective: this.resource.objective,
      summary: this.resource.summary,
      files: this.resource.files,
      symbols: this.resource.symbols,
      sourceRevisionId: this.resource.sourceRevisionId,
      storyId: this.resource.storyId,
      validationKind: this.resource.validationKind,
      validationTaskId: this.resource.validationTaskId,
      createdAt: this.resource.createdAt,
    }
  }
}
