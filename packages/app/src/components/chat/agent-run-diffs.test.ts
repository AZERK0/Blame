import assert from "node:assert/strict"
import test from "node:test"

import { loadAgentRunPatch } from "./agent-run-diff-range.ts"

test("loads the final run diff between its checkpoint and captured head", async () => {
  const comparisons: number[] = []
  const patch = await loadAgentRunPatch({
    ...diffFixture(comparisons),
    from: { checkpointRunCount: 2, sessionId: "session-2" },
    toRef: "captured-head",
  })

  assert.deepEqual(comparisons, [2])
  assert.equal(patch, "between:ref-2:captured-head")
})

test("does not replace a persisted run diff with the current workspace diff", async () => {
  await assert.rejects(
    loadAgentRunPatch({
      compareCheckpoint: async () => {
        throw new Error("Checkpoint unavailable")
      },
      diffBetween: async () => "between",
      from: { checkpointRunCount: 1, sessionId: "session-1" },
      toRef: "captured-head",
    }),
    /Checkpoint unavailable/
  )
})

function diffFixture(comparisons: number[]) {
  return {
    compareCheckpoint: async ({
      checkpointRunCount,
    }: {
      checkpointRunCount: number
    }) => {
      comparisons.push(checkpointRunCount)
      return `ref-${checkpointRunCount}`
    },
    diffBetween: async (from: string, to: string) => `between:${from}:${to}`,
  }
}
