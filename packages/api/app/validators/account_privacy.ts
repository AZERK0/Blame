import vine from '@vinejs/vine'

const currentPassword = () => vine.string().minLength(1).maxLength(1024)

export const accountExportValidator = vine.create({
  password: currentPassword(),
})

export const accountClosureValidator = vine.create({
  password: currentPassword(),
  confirmation: vine.string().email().maxLength(254),
})

export const accountClosureStatusValidator = vine.create({
  requestId: vine.string().trim().uuid(),
  receiptToken: vine.string().trim().minLength(32).maxLength(256),
})
