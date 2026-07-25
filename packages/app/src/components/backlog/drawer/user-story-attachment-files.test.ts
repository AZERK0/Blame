import assert from "node:assert/strict"
import test from "node:test"

import { pendingFileAttachments } from "./user-story-attachment-files.ts"

test("preserves stored attachment references while editing", () => {
  const attachment = {
    downloadUrl: "https://storage.example/attachment",
    id: "attachment-id",
    name: "attachment.txt",
    size: 42,
    type: "text/plain",
  }

  const [pending] = pendingFileAttachments([attachment])

  assert.equal(pending?.file.size, 0)
  assert.equal(pending?.previewUrl, attachment.downloadUrl)
  assert.equal(pending?.storedAttachment, attachment)
})
