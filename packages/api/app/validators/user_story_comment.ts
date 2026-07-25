import vine from '@vinejs/vine'
import { codeSelectionAttachment, fileAttachment } from '#validators/user_story'

export const createUserStoryCommentValidator = vine.create({
  body: vine.string().trim().minLength(1).maxLength(32768),
  codeSelectionAttachments: vine.array(codeSelectionAttachment).nullable().optional(),
  fileAttachments: vine.array(fileAttachment).nullable().optional(),
})

export const undoUserStoryCommentValidator = vine.create({
  clineSessionId: vine.string().trim().maxLength(255).optional(),
  runId: vine.string().trim().uuid(),
})
