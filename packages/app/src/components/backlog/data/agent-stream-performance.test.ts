import assert from "node:assert/strict"
import { performance } from "node:perf_hooks"
import test from "node:test"

import type { AgentEvent } from "@blame/agent-runtime"

import { resumableEventStreamUrl } from "./agent-event-stream-url.ts"
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
  assert.equal(streamedActivity(store)?.detail, "hello")
  await coordinator.close()
})

test("adds the confirmed sequence to a resumed event stream", () => {
  const url = resumableEventStreamUrl(
    "http://127.0.0.1:1234/agent/sessions/session/events?token=secret",
    42
  )

  assert.equal(new URL(url).searchParams.get("lastEventId"), "42")
  assert.equal(new URL(url).searchParams.get("token"), "secret")
})

test("processes thousands of deltas with frame-bound renders and bounded writes", async () => {
  const frames = new FrameScheduler()
  const store = new AgentStreamStore(frames)
  let writes = 0
  let inactiveRenders = 0
  const unsubscribe = store.subscribeOrder(
    { runId: "run-2", sessionId: "session-2" },
    () => {
      inactiveRenders += 1
    }
  )
  const coordinator = coordinatorWith(store, () => {
    writes += 1
  })
  const startedAt = performance.now()
  coordinator.push(delta(1, "x"))
  frames.paint()
  const initialOrder = store.orderSnapshot(identity)
  store.resetMetrics()
  for (let sequence = 2; sequence <= 5_000; sequence += 1) {
    coordinator.push(delta(sequence, "x"))
  }
  frames.paint()
  await coordinator.flush()
  const elapsedMs = performance.now() - startedAt

  assert.equal(store.renders(), 1)
  assert.equal(store.orderRenders(), 0)
  assert.equal(store.orderSnapshot(identity), initialOrder)
  assert.equal(inactiveRenders, 0)
  assert.ok(writes <= 2)
  assert.ok(elapsedMs < 1_000)
  assert.equal(streamedActivity(store)?.detail.length, 5_000)
  unsubscribe()
  await coordinator.close()
})

test("keeps messages and tools in distinct ordered containers", async () => {
  const frames = new FrameScheduler()
  const store = new AgentStreamStore(frames)
  const coordinator = coordinatorWith(store, () => undefined)

  coordinator.push(delta(1, "message A"))
  frames.paint()
  await coordinator.push(toolEvent(2, "tool_call", "tool-1"))
  frames.paint()
  await coordinator.push(toolEvent(3, "tool_result", "tool-1"))
  frames.paint()
  coordinator.push(delta(4, "message B"))
  frames.paint()

  assert.deepEqual(
    streamedActivities(store).map((item) => item.kind),
    ["message", "tool", "message"]
  )
  assert.equal(new Set(streamedActivityIds(store)).size, 3)
  await coordinator.close()
})

test("keeps successive tools as separate activities", async () => {
  const frames = new FrameScheduler()
  const store = new AgentStreamStore(frames)
  const coordinator = coordinatorWith(store, () => undefined)

  await coordinator.push(toolEvent(1, "tool_call", "tool-1"))
  await coordinator.push(toolEvent(2, "tool_result", "tool-1"))
  await coordinator.push(toolEvent(3, "tool_call", "tool-2"))
  frames.paint()

  const tools = streamedActivities(store).filter((item) => item.kind === "tool")
  assert.equal(tools.length, 2)
  assert.notEqual(tools[0]?.id, tools[1]?.id)
  await coordinator.close()
})

test("keeps optimistic activities after a persistence failure", async () => {
  const frames = new FrameScheduler()
  const store = new AgentStreamStore(frames)
  const coordinator = coordinatorWith(store, () =>
    Promise.reject(new Error("offline"))
  )

  coordinator.push(delta(1, "still visible"))
  frames.paint()
  await assert.rejects(coordinator.flush(), /offline/)

  assert.equal(streamedActivity(store)?.detail, "still visible")
  await coordinator.close().catch(() => undefined)
})

test("merges recovered snapshots and ignores replayed event ids", async () => {
  const firstFrames = new FrameScheduler()
  const persisted: AgentStreamSnapshot[] = []
  const first = coordinatorWith(
    new AgentStreamStore(firstFrames),
    (snapshot) => {
      persisted.push(snapshot)
    }
  )
  first.push(delta(1, "message A"))
  await first.push(toolEvent(2, "tool_call", "tool-1"))
  first.push(delta(3, "message B"))
  await first.flush()
  await first.close()

  const toolStore = recoveredStore(persisted.slice(0, 2))
  assert.deepEqual(
    streamedActivities(toolStore).map((item) => item.kind),
    ["message", "tool"]
  )
  assert.equal(streamedActivity(toolStore)?.status, "running")

  const store = new AgentStreamStore(new FrameScheduler())
  const resumed = new AgentStreamCoordinator({
    ...identity,
    executionId: "00000000-0000-4000-8000-000000000001",
    initialState: {},
    lastSequenceNumber: 0,
    persist: () => undefined,
    recoveredSnapshots: persisted.map((snapshot) => ({
      event: snapshot.persistenceEvent,
      update: snapshot.update,
    })),
    store,
  })
  resumed.push(delta(3, "message B"))

  assert.deepEqual(
    streamedActivities(store).map((item) => item.kind),
    ["message", "tool", "message"]
  )
  assert.equal(streamedActivity(store)?.detail, "message B")
  await resumed.close()
})

test("does not replay deltas already covered by a recovered snapshot", async () => {
  const persisted: AgentStreamSnapshot[] = []
  const first = coordinatorWith(
    new AgentStreamStore(new FrameScheduler()),
    (snapshot) => {
      persisted.push(snapshot)
    }
  )
  first.push(delta(1, "A"))
  first.push(delta(2, "B"))
  await first.flush()
  await first.close()

  const store = recoveredStore(persisted)
  const resumed = new AgentStreamCoordinator({
    ...identity,
    executionId: "00000000-0000-4000-8000-000000000001",
    initialState: {},
    persist: () => undefined,
    recoveredSnapshots: persisted.map((snapshot) => ({
      event: snapshot.persistenceEvent,
      update: snapshot.update,
    })),
    store,
  })
  resumed.push(delta(1, "A"))

  assert.equal(streamedActivity(store)?.detail, "AB")
  await resumed.close()
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

function toolEvent(
  sequenceNumber: number,
  hookEventName: "tool_call" | "tool_result",
  toolCallId: string
): AgentEvent {
  return {
    ...event(sequenceNumber, "tool"),
    payload: {
      hookEventName,
      iteration: 1,
      toolCallId,
      toolName: "read_file",
    },
  }
}

type AgentStreamSnapshot = Parameters<
  ConstructorParameters<typeof AgentStreamCoordinator>[0]["persist"]
>[0]

function streamedActivityIds(store: AgentStreamStore) {
  return store.orderSnapshot(identity).activityIds
}

function streamedActivities(store: AgentStreamStore) {
  return streamedActivityIds(store).flatMap((activityId) => {
    const activity = store.activitySnapshot(identity, activityId)?.activity
    return activity ? [activity] : []
  })
}

function streamedActivity(store: AgentStreamStore) {
  return streamedActivities(store).at(-1)
}

function recoveredStore(snapshots: AgentStreamSnapshot[]) {
  const store = new AgentStreamStore(new FrameScheduler())
  new AgentStreamCoordinator({
    ...identity,
    executionId: "00000000-0000-4000-8000-000000000001",
    initialState: {},
    persist: () => undefined,
    recoveredSnapshots: snapshots.map((snapshot) => ({
      event: snapshot.persistenceEvent,
      update: snapshot.update,
    })),
    store,
  })
  return store
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
