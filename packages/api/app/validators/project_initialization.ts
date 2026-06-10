import vine from '@vinejs/vine'

const practice = vine.enum([
  'coding_style',
  'unit_tests',
  'layered_architecture',
  'commit_message_convention',
])

export const startProjectInitializationValidator = vine.create({
  providerId: vine.string().trim().minLength(1).maxLength(80),
  modelId: vine.string().trim().minLength(1).maxLength(255),
  clineSessionId: vine.string().trim().maxLength(255).nullable().optional(),
})

export const completeProjectInitializationValidator = vine.create({
  clineSessionId: vine.string().trim().maxLength(255).nullable().optional(),
  setupScript: vine.string().minLength(1),
  dockerCompose: vine.string().minLength(1),
  practices: vine.array(
    vine.object({
      practice,
      detected: vine.boolean(),
      comment: vine.string().trim().minLength(1).maxLength(2048),
    })
  ),
})

export const failProjectInitializationValidator = vine.create({
  clineSessionId: vine.string().trim().maxLength(255).nullable().optional(),
  error: vine.string().trim().minLength(1).maxLength(4096),
})

export const repairProjectInitializationValidator = vine.create({
  clineSessionId: vine.string().trim().maxLength(255).nullable().optional(),
  setupScript: vine.string().minLength(1),
  dockerCompose: vine.string().minLength(1),
  reason: vine.string().trim().minLength(1).maxLength(4096),
})
