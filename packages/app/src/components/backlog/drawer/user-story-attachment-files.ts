import type { UserStoryFileAttachment } from "@/components/backlog/data/backlog-data"

export function pendingFileAttachments(attachments: UserStoryFileAttachment[]) {
  return attachments.map((attachment) => ({
    file: fileFromAttachment(attachment),
    id: attachment.id,
  }))
}

function fileFromAttachment(attachment: UserStoryFileAttachment) {
  const binary = atob(attachment.content)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new File([bytes], attachment.name, { type: attachment.type })
}
