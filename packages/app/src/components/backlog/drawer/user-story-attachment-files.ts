import type { UserStoryFileAttachment } from "@/components/backlog/data/backlog-data"

export async function fileAttachment(file: File): Promise<UserStoryFileAttachment> {
  return {
    content: await fileContent(file),
    id: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    type: file.type,
  }
}

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

function fileContent(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener("load", () => {
      const value = typeof reader.result === "string" ? reader.result : ""
      resolve(value.split(",", 2)[1] ?? "")
    })
    reader.addEventListener("error", () => reject(reader.error))
    reader.readAsDataURL(file)
  })
}
