import vine from '@vinejs/vine'

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
  category: vine.enum(['web', 'mobile', 'desktop', 'terminal', 'service', 'other']).optional(),
  services: vine
    .array(vine.string().trim().minLength(1).maxLength(80))
    .minLength(1)
    .maxLength(20)
    .optional(),
  previewService: vine.string().trim().minLength(1).maxLength(80).nullable().optional(),
  scopes: vine
    .array(vine.string().trim().minLength(1).maxLength(500))
    .minLength(1)
    .maxLength(50)
    .optional(),
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
