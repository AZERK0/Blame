import vine from '@vinejs/vine'

export const saveSecurityAuditValidator = vine.create({
  audit: vine.any(),
})
