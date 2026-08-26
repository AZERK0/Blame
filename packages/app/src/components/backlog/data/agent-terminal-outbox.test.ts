import assert from "node:assert/strict"
import test from "node:test"

import {
  acknowledgeTerminalAgentUpdate,
  pendingTerminalAgentUpdates,
  persistTerminalAgentUpdate,
} from "./agent-terminal-outbox.ts"
import { BacklogApiError } from "./backlog-api.ts"
import type { UserStory, UserStoryAgentRun } from "./backlog-data.ts"

test("keeps a failed terminal persistence durable for retry", async () => {
  const storage = memoryStorage()

  await assert.rejects(
    persistTerminalAgentUpdate(storage, story, update, async () => {
      throw new Error("offline")
    }),
    /offline/
  )

  const pending = pendingTerminalAgentUpdates(storage, story.projectId)
  assert.equal(pending.length, 1)
  assert.equal(pending[0].runInput.finalResponse, "final answer")
})

test("acknowledges only the persisted outbox revision", async () => {
  const storage = memoryStorage()
  await persistTerminalAgentUpdate(
    storage,
    story,
    update,
    async () => undefined
  )
  assert.equal(pendingTerminalAgentUpdates(storage, story.projectId).length, 0)

  await assert.rejects(
    persistTerminalAgentUpdate(storage, story, update, async () => {
      throw new Error("offline")
    })
  )
  const pending = pendingTerminalAgentUpdates(storage, story.projectId)[0]
  acknowledgeTerminalAgentUpdate(storage, {
    id: pending.id,
    revision: "older-revision",
  })
  assert.equal(pendingTerminalAgentUpdates(storage, story.projectId).length, 1)
})

test("keeps a terminal update rejected by a non-retryable response", async () => {
  const storage = memoryStorage()

  await assert.rejects(
    persistTerminalAgentUpdate(storage, story, update, async () => {
      throw new BacklogApiError(422, "Invalid terminal update")
    }),
    /Invalid terminal update/
  )

  assert.equal(pendingTerminalAgentUpdates(storage, story.projectId).length, 1)
})

test("stores a cancelled finalization for retry", async () => {
  const storage = memoryStorage()
  const cancelledUpdate = {
    ...update,
    runInput: { ...update.runInput, status: "cancelled" as const },
  }

  await assert.rejects(
    persistTerminalAgentUpdate(storage, story, cancelledUpdate, async () => {
      throw new Error("offline")
    }),
    /offline/
  )

  const pending = pendingTerminalAgentUpdates(storage, story.projectId)
  assert.equal(pending.length, 1)
  assert.equal(pending[0]?.runInput.status, "cancelled")
})

const story = {
  id: "story-1",
  projectId: "project-1",
} as UserStory

const run = { id: "run-1" } as UserStoryAgentRun

const update = {
  activities: [],
  input: { agentStatus: null as null },
  run,
  runInput: {
    finalResponse: "final answer",
    status: "completed" as const,
  },
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
