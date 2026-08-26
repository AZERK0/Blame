import assert from "node:assert/strict"
import test from "node:test"

import {
  agentTurnElapsedTime,
  formatAgentTurnDuration,
  latestLinkedAgentTurn,
  type AgentTurnMetricRun,
} from "./agent-turn-metrics-data.ts"

type LinkedRun = AgentTurnMetricRun & { messageId?: string | null }

const firstRun = run("run-1", "message-1")
const secondRun = run("run-2", "message-2")

test("selects the run linked to the latest user message", () => {
  const turn = latestLinkedAgentTurn(
    [
      { createdAt: "2026-01-01T00:00:00.000Z", id: "message-1" },
      { createdAt: "2026-01-01T00:01:00.000Z", id: "message-2" },
    ],
    [firstRun, secondRun],
    (candidate) => candidate.messageId
  )

  assert.equal(turn?.run.id, "run-2")
})

test("resets while the latest user message has no run", () => {
  const turn = latestLinkedAgentTurn(
    [
      { createdAt: "2026-01-01T00:00:00.000Z", id: "message-1" },
      { createdAt: "2026-01-01T00:01:00.000Z", id: "message-2" },
    ],
    [firstRun],
    (candidate) => candidate.messageId
  )

  assert.equal(turn, undefined)
})

test("formats compact execution durations", () => {
  assert.equal(formatAgentTurnDuration(9_000), "9s")
  assert.equal(formatAgentTurnDuration(63_000), "1m 03s")
  assert.equal(formatAgentTurnDuration(7_260_000), "2h 01m")
})

test("measures running time from the user message", () => {
  assert.equal(
    agentTurnElapsedTime(
      { ...firstRun, status: "running" },
      "2026-01-01T00:00:00.000Z",
      Date.parse("2026-01-01T00:01:03.000Z")
    ),
    63_000
  )
})

test("freezes completed time at the run completion", () => {
  assert.equal(
    agentTurnElapsedTime(
      {
        ...firstRun,
        completedAt: "2026-01-01T00:01:03.000Z",
      },
      "2026-01-01T00:00:00.000Z",
      Date.parse("2026-01-01T01:00:00.000Z")
    ),
    63_000
  )
})

function run(id: string, messageId: string): LinkedRun {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    id,
    messageId,
    status: "completed",
  }
}
