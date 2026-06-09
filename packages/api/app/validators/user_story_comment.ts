import vine from '@vinejs/vine'

const codeSelectionAttachment = vine.object({
  id: vine.string().trim().minLength(1).maxLength(255),
  content: vine.string().maxLength(262144),
  endLine: vine.number(),
  path: vine.string().trim().minLength(1).maxLength(2048),
  startLine: vine.number(),
})
const fileAttachment = vine.object({
  id: vine.string().trim().minLength(1).maxLength(255),
  content: vine.string().maxLength(10485760),
  name: vine.string().trim().minLength(1).maxLength(255),
  size: vine.number(),
  type: vine.string().trim().maxLength(255),
})

export const createUserStoryCommentValidator = vine.create({
  body: vine.string().trim().minLength(1).maxLength(32768),
  codeSelectionAttachments: vine.array(codeSelectionAttachment).nullable().optional(),
  fileAttachments: vine.array(fileAttachment).nullable().optional(),
})
