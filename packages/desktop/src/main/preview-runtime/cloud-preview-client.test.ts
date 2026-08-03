import assert from "node:assert/strict"
import test from "node:test"
import {
  CloudPreviewClient,
  isCloudPreviewSessionId,
} from "./cloud-preview-client.ts"

test("restricts packaged cloud credentials to the official API", () => {
  assert.doesNotThrow(
    () =>
      new CloudPreviewClient(
        { token: "a".repeat(32), url: "https://api.blame.so/api/v1" },
        { packaged: true },
      ),
  )
  assert.throws(
    () =>
      new CloudPreviewClient(
        { token: "a".repeat(32), url: "https://attacker.example/api/v1" },
        { packaged: true },
      ),
    /invalid/,
  )
})

test("allows loopback development APIs without allowing arbitrary hosts", () => {
  assert.doesNotThrow(
    () =>
      new CloudPreviewClient(
        { token: "a".repeat(32), url: "http://127.0.0.1:3333/api/v1" },
        { packaged: false },
      ),
  )
  assert.throws(
    () =>
      new CloudPreviewClient(
        { token: "a".repeat(32), url: "https://staging.attacker.example/api/v1" },
        { packaged: false },
      ),
    /invalid/,
  )
})

test("accepts only server-issued managed preview session IDs", () => {
  assert.equal(
    isCloudPreviewSessionId("preview_bbcb1626c004cdec3aad60175f1f0cae"),
    true,
  )
  assert.equal(isCloudPreviewSessionId("preview/../../credentials"), false)
  assert.equal(isCloudPreviewSessionId("preview-not-a-server-id"), false)
})

test("prepares an upload without serializing workspace bytes", async (context) => {
  let requestBody: unknown
  context.mock.method(globalThis, "fetch", async (_url, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        artifactId: "artifact-id",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        headers: {},
        url: "https://storage.example/artifact",
      }),
      { status: 200 },
    )
  })
  const client = new CloudPreviewClient({
    token: "a".repeat(32),
    url: "http://127.0.0.1:3333/api/v1",
  })
  await client.prepareSourceUpload("preview_bbcb1626c004cdec3aad60175f1f0cae", {
    content: Buffer.alloc(1024 * 1024),
    sha256: "b".repeat(64),
    size: 1024 * 1024,
    sourceRevision: "c".repeat(40),
  })
  assert.deepEqual(requestBody, {
    action: "prepare",
    sha256: "b".repeat(64),
    size: 1024 * 1024,
    sourceRevision: "c".repeat(40),
  })
})
