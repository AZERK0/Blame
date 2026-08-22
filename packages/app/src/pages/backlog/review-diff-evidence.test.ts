import assert from "node:assert/strict"
import test from "node:test"

import { currentReviewDiffEmpty } from "./review-diff-evidence.ts"

test("review evidence includes committed work since the story base", async () => {
  const calls: Array<{ from: string; root: string }> = []
  const workspace = {
    async gitDiffFrom(input: { from: string; root: string }) {
      calls.push(input)
      return "diff --git a/source.ts b/source.ts\n"
    },
  }
  const empty = await currentReviewDiffEmpty(
    { baseCommit: "base-commit", worktree: "/story-worktree" },
    workspace
  )

  assert.equal(empty, false)
  assert.deepEqual(calls, [{ from: "base-commit", root: "/story-worktree" }])
})

test("review evidence marks a story empty only from its base commit", async () => {
  const empty = await currentReviewDiffEmpty(
    { baseCommit: "base-commit", worktree: "/story-worktree" },
    {
      async gitDiffFrom() {
        return ""
      },
    }
  )

  assert.equal(empty, true)
})

test("review evidence never skips merge without a base commit", async () => {
  let called = false
  const empty = await currentReviewDiffEmpty(
    { worktree: "/story-worktree" },
    {
      async gitDiffFrom() {
        called = true
        return ""
      },
    }
  )

  assert.equal(empty, false)
  assert.equal(called, false)
})
