import assert from "node:assert/strict"
import test from "node:test"

import {
  initialUserStoryDiffTargets,
  suspendedUserStoryDiffTargetCount,
  userStoryDiffTargetKey,
  type UserStoryDiffTarget,
} from "./user-story-diff-target-selection.ts"

test("reuses historical targets when a running story moves to review", () => {
  const historical = historicalTarget("done-1")
  const running = workingTarget(false)
  const loaded = new Set([userStoryDiffTargetKey(historical)])
  const review = { ...running, refresh: true }

  assert.deepEqual(initialUserStoryDiffTargets([historical, review], loaded), [
    review,
  ])
  assert.equal(suspendedUserStoryDiffTargetCount([historical, running]), 1)
})

test("loads a newly created historical target", () => {
  const previous = historicalTarget("done-1")
  const next = historicalTarget("done-2")
  const loaded = new Set([userStoryDiffTargetKey(previous)])

  assert.deepEqual(initialUserStoryDiffTargets([previous, next], loaded), [
    next,
  ])
})

function historicalTarget(id: string): UserStoryDiffTarget {
  return {
    from: `${id}-from`,
    id,
    mode: "historical",
    root: "/project",
    to: `${id}-to`,
  }
}

function workingTarget(refresh: boolean): UserStoryDiffTarget {
  return {
    id: "active",
    mode: "working",
    refresh,
    root: "/project/active",
  }
}
