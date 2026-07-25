import FileAttachmentsService from '#services/file_attachments_service'
import { createFileAttachmentUploadValidator } from '#validators/file_attachment'
import type { HttpContext } from '@adonisjs/core/http'

export default class FileAttachmentsController {
  async createUpload({ auth, request }: HttpContext) {
    const input = await request.validateUsing(createFileAttachmentUploadValidator)
    return new FileAttachmentsService().createUpload(auth.getUserOrFail().id, input)
  }

  complete({ auth, params }: HttpContext) {
    return new FileAttachmentsService().completeUpload(auth.getUserOrFail().id, params.id)
  }

  show({ auth, params }: HttpContext) {
    return new FileAttachmentsService().deliverForUser(auth.getUserOrFail().id, params.id)
  }
}
