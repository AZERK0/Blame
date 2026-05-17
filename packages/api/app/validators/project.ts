import vine from '@vinejs/vine'

export const ensureProjectValidator = vine.create({
  name: vine.string().trim().minLength(1).maxLength(255),
  repositoryFingerprint: vine.string().trim().minLength(1).maxLength(255).nullable().optional(),
})
