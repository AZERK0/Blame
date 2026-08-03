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
