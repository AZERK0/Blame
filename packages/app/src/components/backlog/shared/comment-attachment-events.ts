export type CodeSelectionAttachment = {
  content: string
  endLine: number
  path: string
  startLine: number
}

export type PendingCodeSelectionAttachment = CodeSelectionAttachment & {
  id: string
}

export const codeSelectionAttachmentEvent = "backlog:code-selection-attachment"

export function dispatchCodeSelectionAttachment(attachment: CodeSelectionAttachment) {
  window.dispatchEvent(new CustomEvent(codeSelectionAttachmentEvent, { detail: attachment }))
}

export function codeSelectionLineLabel(attachment: Pick<CodeSelectionAttachment, "endLine" | "startLine">) {
  if (attachment.startLine === attachment.endLine) return `Line ${attachment.startLine}`
  return `Lines ${attachment.startLine}-${attachment.endLine}`
}
