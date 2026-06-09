import type UserStoryComment from '#models/user_story_comment'
import { BaseTransformer } from '@adonisjs/core/transformers'

export default class UserStoryCommentTransformer extends BaseTransformer<UserStoryComment> {
  toObject() {
    return this.pick(this.resource, [
      'id',
      'userStoryId',
      'body',
      'codeSelectionAttachments',
      'fileAttachments',
      'author',
      'createdAt',
      'updatedAt',
    ])
  }
}
