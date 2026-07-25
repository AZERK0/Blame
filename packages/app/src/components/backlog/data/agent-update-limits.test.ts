import assert from "node:assert/strict"
import test from "node:test"

import {
  agentStoryTextLimit,
  boundedAgentMessage,
  boundedAgentUpdate,
} from "./agent-update-limits.ts"

test("bounds persisted agent story fields to the API limit", () => {
  const oversized = "x".repeat(agentStoryTextLimit + 500)
  const update = boundedAgentUpdate({
    agentLastError: oversized,
    agentLastEvent: oversized,
  })

  assert.equal(update.agentLastError?.length, agentStoryTextLimit)
  assert.equal(update.agentLastEvent?.length, agentStoryTextLimit)
})

test("preserves null and missing agent story fields", () => {
  assert.deepEqual(boundedAgentUpdate({ agentLastError: null }), {
    agentLastError: null,
  })
  assert.deepEqual(boundedAgentUpdate({ status: "in-review" }), {
    status: "in-review",
  })
})

test("uses a bounded fallback for empty event text", () => {
  assert.equal(boundedAgentMessage("", "Agent completed"), "Agent completed")
})
