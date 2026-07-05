import assert from "node:assert/strict"
import test from "node:test"

import type { AgentEvent } from "@blame/agent-runtime"

import type { QuickChat, QuickChatAgentRun } from "./quick-chat-data.ts"
import {
  pendingQuickChatAgentUpdate,
  quickChatAgentEventUpdate,
  quickChatAgentRunEventUpdate,
} from "./quick-chat-agent-flow.ts"
import type { UserStoryAgentActivity } from "@/components/backlog/data/backlog-data"

test("marks a completed quick chat agent run", () => {
  const event = agentEvent("done", { text: "Done" })
  const update = quickChatAgentEventUpdate(chat(), event)
  const runUpdate = quickChatAgentRunEventUpdate(update, event, "Done")

  assert.equal(update.agentLastError, null)
  assert.equal(update.agentLastEvent, "Done")
  assert.equal(update.agentStatus, null)
  assert.equal(runUpdate.status, "completed")
  assert.ok(runUpdate.completedAt)
})

test("keeps quick chat running after a nonterminal done event", () => {
  const event = agentEvent("done", {
    finishReason: "stop",
    text: "Intermediate answer",
  })
  const update = quickChatAgentEventUpdate(chat(), event)
  const runUpdate = quickChatAgentRunEventUpdate(
    update,
    event,
    "Intermediate answer"
  )

  assert.equal(update.agentStatus, undefined)
  assert.equal(update.agentFinalResponse, undefined)
  assert.equal(runUpdate.status, undefined)
  assert.equal(runUpdate.completedAt, undefined)
})

test("marks a failed quick chat agent run", () => {
  const event = agentEvent("error", { message: "Boom" })
  const update = quickChatAgentEventUpdate(chat(), event)
  const runUpdate = quickChatAgentRunEventUpdate(update, event, "Boom")

  assert.equal(update.agentLastError, "Boom")
  assert.equal(update.agentLastEvent, "Boom")
  assert.equal(update.agentStatus, null)
  assert.equal(runUpdate.finalResponse, "Boom")
  assert.equal(runUpdate.status, "failed")
  assert.ok(runUpdate.completedAt)
})

test("accumulates queued quick chat activity updates", () => {
  const first = pendingQuickChatAgentUpdate(
    undefined,
    { agentActivity: activity("tool", "running") },
    run(),
    {}
  )
  const second = pendingQuickChatAgentUpdate(
    first,
    {
      agentActivity: activity("tool", "completed"),
      agentLastEvent: "Completed tool",
    },
    run(),
    { finalResponse: "Finished" }
  )

  assert.deepEqual(
    second.activities.map((item) => [item.id, item.status]),
    [["tool", "completed"]]
  )
  assert.equal(second.input.agentLastEvent, "Completed tool")
  assert.equal(second.runInput.finalResponse, "Finished")
})

function chat(): QuickChat {
  return {
    createdAt: "2026-06-25T10:00:00.000Z",
    id: 1,
    projectId: "project",
    title: "Quick change",
  }
}

function run(): QuickChatAgentRun {
  return {
    createdAt: "2026-06-25T10:00:00.000Z",
    id: 1,
    kind: "resume",
    quickChatId: 1,
    status: "running",
  }
}

function activity(
  id: string,
  status: UserStoryAgentActivity["status"]
): UserStoryAgentActivity {
  return {
    createdAt: "2026-06-25T10:00:00.000Z",
    detail: "",
    id,
    kind: "tool",
    status,
    title: id,
    updatedAt: "2026-06-25T10:00:01.000Z",
  }
}

function agentEvent(type: AgentEvent["type"], payload: unknown): AgentEvent {
  return { payload, type }
}
