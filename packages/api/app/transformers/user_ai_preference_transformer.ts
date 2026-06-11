import type UserAiPreference from '#models/user_ai_preference'
import { BaseTransformer } from '@adonisjs/core/transformers'

export default class UserAiPreferenceTransformer extends BaseTransformer<UserAiPreference> {
  toObject() {
    return {
      alternativeModel: {
        providerId: this.resource.alternativeProviderId,
        modelId: this.resource.alternativeModelId,
        credentialLabel: this.resource.alternativeCredentialLabel,
        reasoningEffort: this.resource.alternativeReasoningEffort,
      },
      agentModel: {
        providerId: this.resource.agentProviderId,
        modelId: this.resource.agentModelId,
        credentialLabel: this.resource.agentCredentialLabel,
        reasoningEffort: this.resource.agentReasoningEffort,
      },
      createdAt: this.resource.createdAt.toISO(),
      updatedAt: this.resource.updatedAt?.toISO() ?? null,
    }
  }
}
