import assert from "node:assert/strict"
import test from "node:test"

import { blameCloudPreviewOrigin } from "./preview-url.ts"

test("compacts the random Blame cloud preview identifier", () => {
  assert.deepEqual(
    blameCloudPreviewOrigin(
      "https://15e3b6980ee0b5b0aed8644730ba65529f7688c9.preview.blame.so/account"
    ),
    {
      identifier: "15e3b6980ee0b5b0aed8644730ba65529f7688c9",
      compactIdentifier: "15e…8c9",
      protocol: "https://",
      suffix: ".preview.blame.so",
    }
  )
})

test("leaves non-Blame origins to the regular address renderer", () => {
  assert.equal(
    blameCloudPreviewOrigin("https://preview.example.test/account"),
    undefined
  )
  assert.equal(
    blameCloudPreviewOrigin("http://abc.preview.blame.so/account"),
    undefined
  )
})
