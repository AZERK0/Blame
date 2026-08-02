import assert from "node:assert/strict"
import test from "node:test"
import { CloudPreviewClient } from "./cloud-preview-client.ts"

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
