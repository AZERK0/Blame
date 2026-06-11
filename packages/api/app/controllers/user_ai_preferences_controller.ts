import UserAiPreferencesService from '#services/user_ai_preferences_service'
import UserAiPreferenceTransformer from '#transformers/user_ai_preference_transformer'
import { saveUserAiPreferenceValidator } from '#validators/user_ai_preference'
import type { HttpContext } from '@adonisjs/core/http'

export default class UserAiPreferencesController {
  async show({ auth, serialize }: HttpContext) {
    const preference = await new UserAiPreferencesService().get(auth.getUserOrFail().id)
    if (!preference) return { data: null }
    return serialize(UserAiPreferenceTransformer.transform(preference))
  }

  async update({ auth, request, serialize }: HttpContext) {
    const preference = await new UserAiPreferencesService().save(
      auth.getUserOrFail().id,
      await request.validateUsing(saveUserAiPreferenceValidator)
    )
    return serialize(UserAiPreferenceTransformer.transform(preference))
  }
}
