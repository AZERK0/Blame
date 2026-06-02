import UserStoriesService from '#services/user_stories_service'
import UserStoryCommentTransformer from '#transformers/user_story_comment_transformer'
import { createUserStoryCommentValidator } from '#validators/user_story_comment'
import type { HttpContext } from '@adonisjs/core/http'

export default class UserStoryCommentsController {
  async store({ auth, params, request, serialize }: HttpContext) {
    return serialize(
      UserStoryCommentTransformer.transform(
        await new UserStoriesService().createComment(
          auth.getUserOrFail().id,
          params.id,
          await request.validateUsing(createUserStoryCommentValidator)
        )
      )
    )
  }
}
