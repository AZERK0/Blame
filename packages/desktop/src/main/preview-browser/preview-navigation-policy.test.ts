import assert from "node:assert/strict"
import test from "node:test"
import { keepsManagedPreviewBridge } from "./preview-navigation-policy.ts"

const expected = (url: string) => new URL(url).hostname === "localhost"

test("keeps the bridge only for navigation that remains inside the preview", () => {
  assert.equal(keepsManagedPreviewBridge("about:blank", "http://localhost:3000", expected), true)
  assert.equal(
    keepsManagedPreviewBridge("http://localhost:3000", "http://localhost:3333", expected),
    true,
  )
  assert.equal(
    keepsManagedPreviewBridge("http://localhost:3000", "https://example.com", expected),
    false,
  )
  assert.equal(
    keepsManagedPreviewBridge("https://example.com", "http://localhost:3000", expected),
    false,
  )
})
