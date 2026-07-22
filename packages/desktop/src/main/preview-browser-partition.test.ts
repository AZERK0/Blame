import assert from "node:assert/strict"
import test from "node:test"

import { previewPartition } from "./preview-browser-partition.ts"

test("creates stable persistent and isolated preview partitions", () => {
  const first = previewPartition("story:one")
  assert.equal(first, previewPartition("story:one"))
  assert.match(first, /^persist:blame-preview-[a-f0-9]{32}$/)
  assert.notEqual(first, previewPartition("story:two"))
  assert.doesNotMatch(first, /story|one/)
})