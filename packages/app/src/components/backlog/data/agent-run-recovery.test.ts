import assert from "node:assert/strict"
import test from "node:test"

import {
  completedClineLog,
  finalAssistantResponse,
} from "./agent-run-recovery.ts"

test("recognizes completed runs in legacy and structured logs", () => {
  const legacy = JSON.stringify({
    message: "event:done",
    payload: { finishReason: "completed" },
  })
  const structured = JSON.stringify({
    event_name: "blame.agent.event_done",
    attributes: { finishReason: "completed", status: "done" },
  })

  assert.equal(completedClineLog(legacy), true)
  assert.equal(completedClineLog(structured), true)
})

test("does not treat failed done events as completed", () => {
  const log = JSON.stringify({
    event_name: "blame.agent.event_done",
    attributes: { status: "failed" },
  })

  assert.equal(completedClineLog(log), false)
})

test("limits completion events to the recovered run window", () => {
  const log = JSON.stringify({
    timestamp: "2026-07-14T18:20:00.000Z",
    event_name: "blame.agent.event_done",
    attributes: { status: "done" },
  })

  assert.equal(
    completedClineLog(
      log,
      "2026-07-14T18:21:00.000Z",
      "2026-07-14T18:30:00.000Z"
    ),
    false
  )
})

test("recovers the final assistant text inside one run window", () => {
  const messages = {
    messages: [
      message("user", "question", "2026-07-14T18:10:00.000Z"),
      message("assistant", "progress", "2026-07-14T18:10:05.000Z"),
      message("assistant", "final answer", "2026-07-14T18:20:00.000Z"),
      message("user", "next question", "2026-07-14T18:21:00.000Z"),
      message("assistant", "next answer", "2026-07-14T18:22:00.000Z"),
    ],
  }

  assert.equal(
    finalAssistantResponse(
      messages,
      "2026-07-14T18:09:00.000Z",
      "2026-07-14T18:21:00.000Z"
    ),
    "final answer"
  )
})

function message(role: string, text: string, timestamp: string) {
  return {
    role,
    content: [{ type: "text", text }],
    ts: Date.parse(timestamp),
  }
}
