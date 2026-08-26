import assert from "node:assert/strict"
import test from "node:test"

import {
  pendingAgentSnapshots,
  persistAgentSnapshot,
  replayAgentSnapshots,
} from "./agent-snapshot-outbox.ts"

test("keeps only the latest unconfirmed message snapshot", async () => {
  const storage = memoryStorage()
  await assert.rejects(
    persistAgentSnapshot(storage, snapshot(1), async () => {
      throw new Error("offline")
    })
  )
  await assert.rejects(
    persistAgentSnapshot(storage, snapshot(2), async () => {
      throw new Error("offline")
    })
  )

  const pending = pendingAgentSnapshots(storage, "project-1")
  assert.equal(pending.length, 1)
  assert.equal(pending[0]?.event.sequenceNumber, 2)
})

test("replays the outbox once and acknowledges the confirmed sequence", async () => {
  const storage = memoryStorage()
  await assert.rejects(
    persistAgentSnapshot(storage, snapshot(3), async () => {
      throw new Error("offline")
    })
  )
  let writes = 0
  await replayAgentSnapshots(storage, "project-1", "user-story", async () => {
    writes += 1
  })
  await replayAgentSnapshots(storage, "project-1", "user-story", async () => {
    writes += 1
  })

  assert.equal(writes, 1)
  assert.equal(pendingAgentSnapshots(storage, "project-1").length, 0)
})

function snapshot(sequenceNumber: number) {
  return {
    event: {
      createdAt: new Date().toISOString(),
      eventId: `event-${sequenceNumber}`,
      eventType: "text",
      executionId: "execution-1",
      runId: "run-1",
      sequenceNumber,
      sessionId: "session-1",
    },
    messageId: "message-1",
    projectId: "project-1",
    runId: "run-1",
    targetId: "story-1",
    targetType: "user-story" as const,
    update: { text: `${sequenceNumber}` },
  }
}

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size
    },
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  }
}
