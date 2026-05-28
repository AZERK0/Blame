import type ProjectCodePractice from '#models/project_code_practice'
import { BaseTransformer } from '@adonisjs/core/transformers'

export default class ProjectCodePracticeTransformer extends BaseTransformer<ProjectCodePractice> {
  toObject() {
    return {
      id: this.resource.id,
      projectId: this.resource.projectId,
      practice: this.resource.practice,
      detected: Boolean(this.resource.detected),
      enabled: Boolean(this.resource.enabled),
      comment: this.resource.comment,
      createdAt: this.resource.createdAt,
      updatedAt: this.resource.updatedAt,
    }
  }
}
