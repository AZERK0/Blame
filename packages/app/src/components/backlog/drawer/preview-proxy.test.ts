import assert from "node:assert/strict"
import test from "node:test"
import { activePreviewProxy } from "./preview-proxy.ts"

test("shows the proxy indicator for an active Local Container bridge", () => {
  assert.deepEqual(
    activePreviewProxy({
      cloudBridgeRequired: false,
      localBridgeActive: true,
      logicalUrl: "http://localhost:49512/products",
      presentedUrl: "http://localhost:49512/products",
    }),
    {
      kind: "local",
      logicalUrl: "http://localhost:49512/products",
      reasons: [],
    }
  )
})

test("keeps the cloud proxy indicator and its compatibility reasons", () => {
  assert.deepEqual(
    activePreviewProxy({
      cloudBridgeRequired: true,
      localBridgeActive: false,
      logicalUrl: "http://localhost:3000/account",
      presentedUrl: "https://preview.example.test/account",
      publicUrl: "https://preview.example.test",
      reasons: ["Backend uses a browser localhost binding."],
    }),
    {
      kind: "cloud",
      logicalUrl: "http://localhost:3000/account",
      reasons: ["Backend uses a browser localhost binding."],
    }
  )
})

test("does not show a proxy indicator before the local bridge is active", () => {
  assert.equal(
    activePreviewProxy({
      cloudBridgeRequired: false,
      localBridgeActive: false,
      logicalUrl: "http://localhost:49512",
      presentedUrl: "http://localhost:49512",
    }),
    undefined
  )
})
