import vine from '@vinejs/vine'

const isoDate = () =>
  vine
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)

const commonContractFields = {
  subscriberName: vine.string().trim().minLength(1).maxLength(200),
  accountEmail: vine.string().trim().email().maxLength(254),
  password: vine.string().minLength(1).maxLength(1024),
  contractReference: vine.string().trim().maxLength(255).optional(),
  acknowledgementEmail: vine.string().trim().email().maxLength(254),
  deliveryMethod: vine.enum(['download']),
}

export const withdrawalValidator = vine.create({
  ...commonContractFields,
  contractDate: isoDate(),
  confirmation: vine.enum(['confirmer-la-retractation']),
})
