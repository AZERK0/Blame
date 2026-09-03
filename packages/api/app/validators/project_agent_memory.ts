import vine from '@vinejs/vine'

const memoryFile = vine.object({
  hash: vine
    .string()
    .trim()
    .regex(/^(?:[a-f0-9]{64}|absent)$/),
  path: vine
    .string()
    .trim()
    .minLength(1)
    .maxLength(2048)
    .regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)[^\p{Cc}]+$/u),
})

export const storeProjectAgentMemoryValidator = vine.create({
  files: vine.array(memoryFile).minLength(1).maxLength(24),
  fingerprint: vine
    .string()
    .trim()
    .regex(/^[a-f0-9]{64}$/),
  objective: vine.string().trim().minLength(1).maxLength(1000),
  sourceRevisionId: vine.string().trim().minLength(1).maxLength(128),
  storyId: vine.string().trim().minLength(1).maxLength(255).optional(),
  summary: vine.string().trim().minLength(1).maxLength(1600),
  symbols: vine.array(vine.string().trim().minLength(1).maxLength(512)).maxLength(32),
  validationKind: vine.string().trim().minLength(1).maxLength(64).optional(),
  validationTaskId: vine.string().trim().minLength(1).maxLength(255).optional(),
})
