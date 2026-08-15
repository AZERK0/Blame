import vine from '@vinejs/vine'

const hash = () =>
  vine
    .string()
    .trim()
    .regex(/^[a-f0-9]{64}$/)

export const updateDeployTargetValidator = vine.create({
  connectionId: vine.string().uuid(),
  providerProjectId: vine.string().trim().minLength(1).maxLength(160).nullable().optional(),
  providerProjectName: vine
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  manifest: vine.any(),
})

export const createDeploymentValidator = vine.create({
  targetId: vine.string().uuid(),
  operationId: vine.string().uuid(),
  manifest: vine.any(),
  snapshot: vine.object({
    sourceRevision: vine.string().trim().minLength(1).maxLength(128),
    sourceBranch: vine.string().trim().minLength(1).maxLength(255).nullable(),
    detached: vine.boolean(),
    workspaceHash: hash(),
    manifestHash: hash(),
    localChangeCount: vine.number().nonNegative().withoutDecimals(),
    fileCount: vine.number().positive().withoutDecimals(),
    sourceBytes: vine.number().positive().withoutDecimals(),
  }),
  archive: vine.object({
    sha256: hash(),
    size: vine.number().positive().withoutDecimals(),
  }),
})

export const completeDeploymentSourceValidator = vine.create({
  artifactId: vine.string().uuid(),
})
