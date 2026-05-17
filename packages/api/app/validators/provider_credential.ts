import vine from '@vinejs/vine'

export const saveProviderCredentialValidator = vine.create({
  providerId: vine.string().trim().minLength(1).maxLength(80),
  label: vine.string().trim().minLength(1).maxLength(80).optional(),
  apiKey: vine.string().trim().minLength(1),
  baseUrl: vine.string().trim().url().nullable().optional(),
})

export const resolveProviderCredentialValidator = vine.create({
  providerId: vine.string().trim().minLength(1).maxLength(80),
  label: vine.string().trim().minLength(1).maxLength(80).optional(),
})
