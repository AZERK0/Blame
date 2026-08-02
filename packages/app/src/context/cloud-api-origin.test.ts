import assert from "node:assert/strict"
import test from "node:test"

import {
  defaultCloudApiUrl,
  developmentCloudApiUrl,
  productionCloudApiUrl,
} from "./cloud-api-origin.ts"

test("uses the local API for development and production API for packaged builds", () => {
  assert.equal(defaultCloudApiUrl(undefined, true), developmentCloudApiUrl)
  assert.equal(defaultCloudApiUrl(undefined, false), productionCloudApiUrl)
})

test("preserves an explicit cloud API override", () => {
  assert.equal(
    defaultCloudApiUrl(" https://staging.blame.so/api/v1 ", true),
    "https://staging.blame.so/api/v1"
  )
})
