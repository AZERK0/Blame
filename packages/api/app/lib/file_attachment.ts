import type FileAttachment from '#models/file_attachment'

export type FileAttachmentReference = {
  id: string
  aiContextMarkdown?: string
  content?: string
  downloadUrl?: string
  name: string
  size: number
  type: string
}

export function fileAttachmentReference(attachment: FileAttachment): FileAttachmentReference {
  return {
    ...(attachment.aiContextMarkdown ? { aiContextMarkdown: attachment.aiContextMarkdown } : {}),
    ...(attachment.downloadUrl ? { downloadUrl: attachment.downloadUrl } : {}),
    id: attachment.id,
    name: attachment.name,
    size: attachment.size,
    type: attachment.mimeType,
  }
}

export function orderedFileAttachments(attachments: FileAttachment[]) {
  return attachments
    .toSorted((left, right) => pivotPosition(left) - pivotPosition(right))
    .map(fileAttachmentReference)
}

function pivotPosition(attachment: FileAttachment) {
  return Number(attachment.$extras.pivot_position ?? 0)
}
