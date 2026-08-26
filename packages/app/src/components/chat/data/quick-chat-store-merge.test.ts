import assert from "node:assert/strict"
import test from "node:test"

import type { UserStoryAgentActivity } from "../../backlog/data/backlog-data.ts"
import type { QuickChat, QuickChatAgentRun } from "./quick-chat-data.ts"
import { mergeQuickChat } from "./quick-chat-store-merge.ts"

test("does not shorten a streamed message with a stale server response", () => {
  const currentActivity = activity(
    "2026-06-11T10:00:02.000Z",
    "La réponse continue de s'écrire."
  )
  const serverActivity = activity(
    "2026-06-11T10:00:04.000Z",
    "La réponse continue"
  )
  const current = chat(currentActivity)
  const server = {
    ...chat(serverActivity),
    updatedAt: "2026-06-11T10:00:04.000Z",
  }

  const merged = mergeQuickChat(current, server)

  assert.equal(
    merged.agentActivities?.[0]?.detail,
    "La réponse continue de s'écrire."
  )
  assert.equal(
    merged.agentRuns?.[0].activities?.[0]?.detail,
    "La réponse continue de s'écrire."
  )
})

test("keeps a tool call identity when a server response omits it", () => {
  const currentActivity = toolActivity(
    "2026-06-11T10:00:02.000Z",
    "running",
    "call-1"
  )
  const serverActivity = toolActivity("2026-06-11T10:00:04.000Z", "completed")

  const merged = mergeQuickChat(chat(currentActivity), chat(serverActivity))

  assert.equal(merged.agentRuns?.[0].activities?.[0]?.toolCallId, "call-1")
  assert.equal(merged.agentRuns?.[0].activities?.[0]?.status, "completed")
})

test("does not let an older run sequence overwrite live activity state", () => {
  const liveActivity = toolActivity("2026-06-11T10:00:02.000Z", "running")
  const staleActivity = {
    ...toolActivity("2026-06-11T10:00:04.000Z", "completed"),
    detail: "stale detail",
  }
  const current = chat(liveActivity)
  const server = chat(staleActivity)
  current.agentRuns![0] = {
    ...current.agentRuns![0],
    lastSequenceNumber: 10,
  }
  server.agentRuns![0] = {
    ...server.agentRuns![0],
    lastSequenceNumber: 9,
  }

  const merged = mergeQuickChat(current, server)

  assert.equal(merged.agentRuns?.[0]?.lastSequenceNumber, 10)
  assert.equal(merged.agentRuns?.[0]?.activities?.[0]?.detail, "")
  assert.equal(merged.agentRuns?.[0]?.activities?.[0]?.status, "running")
})

test("clears previous run activities when a new run explicitly resets them", () => {
  const previousActivity = activity(
    "2026-06-11T10:00:02.000Z",
    "Ancienne réponse."
  )
  const current = chat(previousActivity)
  const server = {
    ...current,
    agentActivities: [],
    updatedAt: "2026-06-11T10:00:04.000Z",
  }

  const merged = mergeQuickChat(current, server, {
    replaceAgentActivities: true,
  })

  assert.deepEqual(merged.agentActivities, [])
})

function chat(activity: UserStoryAgentActivity): QuickChat {
  return {
    agentActivities: [activity],
    agentRuns: [run(activity)],
    createdAt: "2026-06-11T10:00:00.000Z",
    id: 1,
    projectId: "project",
    title: "Chat",
    updatedAt: "2026-06-11T10:00:03.000Z",
  }
}

function run(activity: UserStoryAgentActivity): QuickChatAgentRun {
  return {
    activities: [activity],
    createdAt: "2026-06-11T10:00:00.000Z",
    id: 1,
    kind: "initial",
    quickChatId: 1,
    status: "running",
    updatedAt: "2026-06-11T10:00:03.000Z",
  }
}

function activity(updatedAt: string, detail: string): UserStoryAgentActivity {
  return {
    createdAt: "2026-06-11T10:00:00.000Z",
    detail,
    id: "message-session-1",
    kind: "message",
    status: "running",
    title: "Agent message",
    updatedAt,
  }
}

function toolActivity(
  updatedAt: string,
  status: UserStoryAgentActivity["status"],
  toolCallId?: string
): UserStoryAgentActivity {
  return {
    createdAt: "2026-06-11T10:00:00.000Z",
    detail: "",
    id: "tool-1",
    kind: "tool",
    toolCallId,
    status,
    title: "Tool",
    updatedAt,
  }
}
