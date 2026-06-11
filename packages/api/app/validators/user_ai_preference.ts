import vine from '@vinejs/vine'

const reasoningEffort = vine.enum(['low', 'medium', 'high', 'xhigh']).nullable()
const credentialLabel = vine.string().trim().nullable()
const modelPreference = vine.object({
  providerId: vine.string().trim().minLength(1),
  modelId: vine.string().trim().minLength(1),
  credentialLabel,
  reasoningEffort,
})

export const saveUserAiPreferenceValidator = vine.create({
  alternativeModel: modelPreference,
  agentModel: modelPreference,
})
