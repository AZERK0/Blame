import assert from "node:assert/strict"
import test from "node:test"

import { totalDiffStats } from "./development-diff-stats-data.ts"

test("totals additions and deletions across changed files", () => {
  assert.deepEqual(
    totalDiffStats([
      { additions: 12, deletions: 3 },
      { additions: 4 },
      { deletions: 8 },
    ]),
    { additions: 16, deletions: 11, files: 3 }
  )
})

test("returns empty stats when the diff has no files", () => {
  assert.deepEqual(totalDiffStats([]), {
    additions: 0,
    deletions: 0,
    files: 0,
  })
})
