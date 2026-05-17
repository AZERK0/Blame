import type Project from '#models/project'
import { BaseTransformer } from '@adonisjs/core/transformers'

export default class ProjectTransformer extends BaseTransformer<Project> {
  toObject() {
    return this.pick(this.resource, [
      'id',
      'userId',
      'repositoryFingerprint',
      'name',
      'createdAt',
      'updatedAt',
    ])
  }
}
