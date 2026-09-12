import assert from "node:assert/strict"
import test from "node:test"

import { currentReviewDiffEmpty } from "./review-diff-evidence.ts"
import { storyWorkingDiff } from "../../components/backlog/development/story-working-diff.ts"

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

test("legacy review uses the project branch instead of the committed story HEAD", async () => {
  const calls: unknown[] = []
  const workspace = {
    async gitLog(input: { root: string; limit: number }) {
      calls.push(input)
      return [{ hash: "project-head" }]
    },
    async gitDiffFrom(input: { from: string; root: string }) {
      calls.push(input)
      return "diff --git a/committed.ts b/committed.ts\n"
    },
    async gitDiff() {
      assert.fail("A clean worktree does not mean its commits are merged")
    },
  }
  const input = { root: "/vm/story", repositoryRoot: "/host/project" }
  assert.match(await storyWorkingDiff(input, workspace), /committed\.ts/)
  assert.equal(
    await currentReviewDiffEmpty(
      { worktree: input.root },
      workspace,
      input.repositoryRoot
    ),
    false
  )
  assert.deepEqual(calls, [
    { root: "/host/project", limit: 1, currentBranchOnly: true },
    { from: "project-head", root: "/vm/story" },
    { root: "/host/project", limit: 1, currentBranchOnly: true },
    { from: "project-head", root: "/vm/story" },
  ])
})

test("working diff retains committed, staged and unstaged changes against the saved base", async () => {
  const patch = ["committed.ts", "staged.ts", "unstaged.ts"]
    .map((path) => `diff --git a/${path} b/${path}\n`)
    .join("")
  assert.equal(
    await storyWorkingDiff(
      {
        root: "/story",
        baseCommit: "starting-commit",
        repositoryRoot: "/project",
      },
      {
        async gitLog() {
          assert.fail("The saved base must stay stable")
        },
        async gitDiff() {
          assert.fail("Must include commits made before a failed merge")
        },
        async gitDiffFrom(input) {
          assert.deepEqual(input, { root: "/story", from: "starting-commit" })
          return patch
        },
      }
    ),
    patch
  )
})

test("unavailable project history never authorizes Mark as Done", async () => {
  assert.equal(
    await currentReviewDiffEmpty(
      { worktree: "/story" },
      {
        async gitLog() {
          throw new Error("Project unavailable")
        },
        async gitDiffFrom() {
          assert.fail("No verified base")
        },
      },
      "/project"
    ),
    false
  )
})
