import assert from "node:assert/strict"
import { performance } from "node:perf_hooks"
import test from "node:test"

import type { AgentEvent } from "@blame/agent-runtime"

import { AgentStreamCoordinator } from "./agent-stream-coordinator.ts"
import { AgentStreamStore } from "./agent-stream-store.ts"

class FrameScheduler {
  private callbacks = new Map<number, () => void>()
  private nextFrame = 1

  cancel(frame: number) {
    this.callbacks.delete(frame)
  }

  request(callback: () => void) {
    const frame = this.nextFrame
    this.nextFrame += 1
    this.callbacks.set(frame, callback)
    return frame
  }

  paint() {
    const callbacks = [...this.callbacks.values()]
    this.callbacks.clear()
    callbacks.forEach((callback) => callback())
  }
}

test("paints the first native delta within one frame", async () => {
  const frames = new FrameScheduler()
  const store = new AgentStreamStore(frames)
  const coordinator = coordinatorWith(store, () => undefined)
  const receivedAt = performance.now()
  coordinator.push(delta(1, "hello"))
  frames.paint()

  assert.ok(performance.now() - receivedAt < 100)
  assert.equal(store.snapshot(identity)?.activity.detail, "hello")
  await coordinator.close()
})

test("processes thousands of deltas with frame-bound renders and bounded writes", async () => {
  const frames = new FrameScheduler()
  const store = new AgentStreamStore(frames)
  let writes = 0
  let inactiveRenders = 0
  const unsubscribe = store.subscribe(
    { runId: "run-2", sessionId: "session-2" },
    () => {
      inactiveRenders += 1
    }
  )
  const coordinator = coordinatorWith(store, () => {
    writes += 1
  })
  const startedAt = performance.now()
  for (let sequence = 1; sequence <= 5_000; sequence += 1) {
    coordinator.push(delta(sequence, "x"))
  }
  frames.paint()
  await coordinator.flush()
  const elapsedMs = performance.now() - startedAt

  assert.equal(store.renders(), 1)
  assert.equal(inactiveRenders, 0)
  assert.ok(writes <= 2)
  assert.ok(elapsedMs < 1_000)
  assert.equal(store.snapshot(identity)?.activity.detail.length, 5_000)
  unsubscribe()
  await coordinator.close()
})

test("flushes text before an activity boundary", async () => {
  const frames = new FrameScheduler()
  const store = new AgentStreamStore(frames)
  const persisted: string[] = []
  const coordinator = coordinatorWith(store, (snapshot) => {
    persisted.push(snapshot.event.type)
  })
  coordinator.push(delta(1, "hello"))
  await coordinator.push({
    ...event(2, "tool"),
    payload: { phase: "start", toolName: "read_file" },
  })

  assert.deepEqual(persisted, ["text", "tool"])
  await coordinator.close()
})

const identity = { runId: "run-1", sessionId: "session-1" }

function coordinatorWith(
  store: AgentStreamStore,
  persist: ConstructorParameters<typeof AgentStreamCoordinator>[0]["persist"]
) {
  return new AgentStreamCoordinator({
    ...identity,
    executionId: "00000000-0000-4000-8000-000000000001",
    initialState: {},
    persist,
    store,
  })
}

function delta(sequenceNumber: number, text: string): AgentEvent {
  return {
    ...event(sequenceNumber, "text"),
    payload: { iteration: 1, text },
  }
}

function event(sequenceNumber: number, type: AgentEvent["type"]): AgentEvent {
  return {
    createdAt: new Date().toISOString(),
    eventId: `event-${sequenceNumber}`,
    eventType: type,
    executionId: "00000000-0000-4000-8000-000000000001",
    payload: {},
    sequenceNumber,
    sessionId: identity.sessionId,
    type,
  }
}
