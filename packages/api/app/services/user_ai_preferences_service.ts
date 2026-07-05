import UserAiPreference from '#models/user_ai_preference'
import type { saveUserAiPreferenceValidator } from '#validators/user_ai_preference'
import type { Infer } from '@vinejs/vine/types'

type SaveUserAiPreferenceInput = Infer<typeof saveUserAiPreferenceValidator>

export default class UserAiPreferencesService {
  get(userId: string) {
    return UserAiPreference.find(userId)
  }

  async save(userId: string, input: SaveUserAiPreferenceInput) {
    const existing = await UserAiPreference.find(userId)
    const values = {
      userId,
      alternativeProviderId: input.alternativeModel.providerId,
      alternativeModelId: input.alternativeModel.modelId,
      alternativeCredentialLabel: input.alternativeModel.credentialLabel,
      alternativeReasoningEffort: input.alternativeModel.reasoningEffort,
      agentProviderId: input.agentModel.providerId,
      agentModelId: input.agentModel.modelId,
      agentCredentialLabel: input.agentModel.credentialLabel,
      agentReasoningEffort: input.agentModel.reasoningEffort,
    }
    if (!existing) return UserAiPreference.create(values)
    existing.merge(values)
    await existing.save()
    return existing
  }
}
