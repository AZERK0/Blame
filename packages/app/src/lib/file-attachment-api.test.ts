import assert from "node:assert/strict"
import test from "node:test"

import { uploadFileAttachments } from "./file-attachment-api.ts"

const originalFetch = globalThis.fetch

test.afterEach(() => {
  globalThis.fetch = originalFetch
})

test("uploads file bytes directly and returns a storage reference", async () => {
  const requests: Array<{
    body: BodyInit | null | undefined
    headers: HeadersInit | undefined
    url: string
  }> = []
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    requests.push({ body: init?.body, headers: init?.headers, url })
    if (url.endsWith("/attachments/uploads")) {
      return Response.json({
        attachment: attachmentReference(),
        upload: {
          expiresAt: "2026-07-25T12:15:00.000Z",
          headers: {
            "Content-Type": "text/plain",
            "x-amz-meta-checksum-sha256": "checksum",
          },
          url: "https://storage.example/upload",
        },
      })
    }
    if (url === "https://storage.example/upload") return new Response(null)
    return Response.json({
      ...attachmentReference(),
      downloadUrl: "https://storage.example/download",
    })
  }

  const [uploaded] = await uploadFileAttachments(
    { token: "token", url: "https://api.example/api/v1" },
    [{ ...attachmentReference(), content: "SGVsbG8=" }]
  )

  assert.equal(uploaded?.content, undefined)
  assert.equal(uploaded?.downloadUrl, "https://storage.example/download")
  assert.deepEqual(
    requests.map((request) => request.url),
    [
      "https://api.example/api/v1/attachments/uploads",
      "https://storage.example/upload",
      "https://api.example/api/v1/attachments/attachment-id/complete",
    ]
  )
  assert.equal(await (requests[1]?.body as Blob).text(), "Hello")
  assert.deepEqual(requests[1]?.headers, {
    "Content-Type": "text/plain",
    "x-amz-meta-checksum-sha256": "checksum",
  })
  assert.equal("content" in JSON.parse(String(requests[0]?.body)), false)
})

function attachmentReference() {
  return {
    id: "attachment-id",
    name: "attachment.txt",
    size: 5,
    type: "text/plain",
  }
}
