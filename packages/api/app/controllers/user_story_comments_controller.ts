import UserStoriesService from '#services/user_stories_service'
import UserStoryCommentTransformer from '#transformers/user_story_comment_transformer'
import UserStoryTransformer from '#transformers/user_story_transformer'
import {
  createUserStoryCommentValidator,
  undoUserStoryCommentValidator,
} from '#validators/user_story_comment'
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

  async undo({ auth, params, request, serialize }: HttpContext) {
    const input = await request.validateUsing(undoUserStoryCommentValidator)
    return serialize(
      UserStoryTransformer.transform(
        await new UserStoriesService().undoComment(
          auth.getUserOrFail().id,
          params.id,
          params.commentId,
          input.runId,
          input.clineSessionId
        )
      )
    )
  }

  async validateUndo({ auth, params, request, response }: HttpContext) {
    const input = await request.validateUsing(undoUserStoryCommentValidator)
    await new UserStoriesService().validateCommentUndo(
      auth.getUserOrFail().id,
      params.id,
      params.commentId,
      input.runId
    )
    return response.noContent()
  }
}
