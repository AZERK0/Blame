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

test("keeps a parallel tool grouped when a server response omits its group", () => {
  const currentActivity = toolActivity(
    "2026-06-11T10:00:02.000Z",
    "running",
    "parallel-tools-1-tool-1"
  )
  const serverActivity = toolActivity("2026-06-11T10:00:04.000Z", "completed")

  const merged = mergeQuickChat(chat(currentActivity), chat(serverActivity))

  assert.equal(
    merged.agentRuns?.[0].activities?.[0]?.parallelGroupId,
    "parallel-tools-1-tool-1"
  )
  assert.equal(merged.agentRuns?.[0].activities?.[0]?.status, "completed")
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
  parallelGroupId?: string
): UserStoryAgentActivity {
  return {
    createdAt: "2026-06-11T10:00:00.000Z",
    detail: "",
    id: "tool-1",
    kind: "tool",
    parallelGroupId,
    status,
    title: "Tool",
    updatedAt,
  }
}
