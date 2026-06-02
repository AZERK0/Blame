import vine from '@vinejs/vine'

export const createUserStoryCommentValidator = vine.create({
  body: vine.string().trim().minLength(1).maxLength(32768),
})
