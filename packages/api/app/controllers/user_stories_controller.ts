import UserStoriesService from '#services/user_stories_service'
import UserStoryTransformer from '#transformers/user_story_transformer'
import {
  createUserStoryValidator,
  listUserStoriesValidator,
  updateUserStoryValidator,
} from '#validators/user_story'
import type { HttpContext } from '@adonisjs/core/http'

export default class UserStoriesController {
  async index({ auth, request, serialize }: HttpContext) {
    const query = await request.validateUsing(listUserStoriesValidator, {
      data: request.qs(),
    })
    const stories = await new UserStoriesService().list(auth.getUserOrFail().id, query)

    return serialize(stories.map((story) => UserStoryTransformer.transform(story)))
  }

  async store({ auth, request, serialize }: HttpContext) {
    return serialize(
      UserStoryTransformer.transform(
        await new UserStoriesService().create(
          auth.getUserOrFail().id,
          await request.validateUsing(createUserStoryValidator)
        )
      )
    )
  }

  async show({ auth, params, serialize }: HttpContext) {
    return serialize(
      UserStoryTransformer.transform(
        await new UserStoriesService().find(auth.getUserOrFail().id, params.id)
      )
    )
  }

  async update({ auth, params, request, serialize }: HttpContext) {
    return serialize(
      UserStoryTransformer.transform(
        await new UserStoriesService().update(
          auth.getUserOrFail().id,
          params.id,
          await request.validateUsing(updateUserStoryValidator)
        )
      )
    )
  }

  async activityDetail({ auth, params, response }: HttpContext) {
    try {
      return await new UserStoriesService().activityDetail(
        auth.getUserOrFail().id,
        params.id,
        params.activityId
      )
    } catch {
      return response.notFound({ message: 'Agent activity not found.' })
    }
  }

  async destroy({ auth, params, response }: HttpContext) {
    await new UserStoriesService().delete(auth.getUserOrFail().id, params.id)
    return response.noContent()
  }
}
