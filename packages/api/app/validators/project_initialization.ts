import vine from '@vinejs/vine'

const practice = vine.enum([
  'coding_style',
  'unit_tests',
  'layered_architecture',
  'commit_message_convention',
])

const runConfiguration = vine.object({
  id: vine
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .maxLength(80),
  name: vine.string().trim().minLength(1).maxLength(120),
  command: vine.string().trim().minLength(1).maxLength(2000),
  cwd: vine.string().trim().minLength(1).maxLength(500),
  default: vine.boolean(),
  previewUrl: vine.string().trim().minLength(1).maxLength(2048).nullable().optional(),
})

export const startProjectInitializationValidator = vine.create({
  providerId: vine.string().trim().minLength(1).maxLength(80),
  modelId: vine.string().trim().minLength(1).maxLength(255),
  clineSessionId: vine.string().trim().maxLength(255).nullable().optional(),
})

export const completeProjectInitializationValidator = vine.create({
  clineSessionId: vine.string().trim().maxLength(255).nullable().optional(),
  previewManifest: vine.any().optional(),
  setupScript: vine.string().minLength(1),
  dockerCompose: vine.string().minLength(1),
  runConfigurations: vine.array(runConfiguration).maxLength(20).optional(),
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
  previewManifest: vine.any().optional(),
  setupScript: vine.string().minLength(1),
  dockerCompose: vine.string().minLength(1),
  runConfigurations: vine.array(runConfiguration).maxLength(20).optional(),
  reason: vine.string().trim().minLength(1).maxLength(4096),
})
