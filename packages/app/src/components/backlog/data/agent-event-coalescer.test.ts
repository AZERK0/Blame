import assert from "node:assert/strict"
import test from "node:test"

import type { AgentEvent } from "@blame/agent-runtime"

import { createAgentEventCoalescer } from "@blame/agent-runtime/agent-event-coalescer"

function event(type: AgentEvent["type"], text: string): AgentEvent {
  return { payload: { iteration: 1, text }, sessionId: "session", type }
}

test("coalesces adjacent text deltas", async () => {
  const events: AgentEvent[] = []
  const coalescer = createAgentEventCoalescer((value) => events.push(value), 5)
  coalescer.push(event("text", "hel"))
  coalescer.push(event("text", "lo"))
  await new Promise((resolve) => setTimeout(resolve, 15))
  assert.equal(events.length, 1)
  assert.equal((events[0]?.payload as { text?: string }).text, "hello")
})

test("flushes a pending delta before a terminal event", () => {
  const events: AgentEvent[] = []
  const coalescer = createAgentEventCoalescer(
    (value) => events.push(value),
    1_000
  )
  coalescer.push(event("reasoning", "thinking"))
  coalescer.push(event("done", "finished"))
  assert.deepEqual(
    events.map((value) => value.type),
    ["reasoning", "done"]
  )
  coalescer.close()
})

test("preserves adjacent deltas with different types", () => {
  const events: AgentEvent[] = []
  const coalescer = createAgentEventCoalescer(
    (value) => events.push(value),
    1_000
  )
  coalescer.push(event("reasoning", "thinking"))
  coalescer.push(event("text", "answer"))
  coalescer.close()
  assert.deepEqual(
    events.map((value) => value.type),
    ["reasoning", "text"]
  )
})

test("continues from accumulated text when the next event is a delta", () => {
  const events: AgentEvent[] = []
  const coalescer = createAgentEventCoalescer(
    (value) => events.push(value),
    1_000
  )
  coalescer.push({
    payload: { accumulatedText: "hel", iteration: 1, text: "hel" },
    sessionId: "session",
    type: "text",
  })
  coalescer.push(event("text", "lo"))
  coalescer.close()
  assert.equal((events[0]?.payload as { text?: string }).text, "hello")
})
