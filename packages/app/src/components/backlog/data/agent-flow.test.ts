import assert from "node:assert/strict"
import test from "node:test"

import type { AgentEvent } from "@blame/agent-runtime"

import type { UserStory } from "./backlog-data.ts"
import { agentFlowUpdate } from "./agent-flow.ts"

test("completes a running tool when a fallback result has no tool call id", () => {
  const started = updateStory(
    story(),
    toolEvent("tool_call", "run_commands", 1)
  )
  const completed = updateStory(
    started,
    toolEvent("tool_result", "run_commands", 1)
  )

  assert.equal(completed.agentActivities?.length, 1)
  assert.equal(completed.agentActivities?.[0]?.status, "completed")
})

test("does not duplicate a completed tool when its fallback result arrives", () => {
  const started = updateStory(
    story(),
    toolEvent("tool_call", "run_commands", 1, "call-1")
  )
  const completed = updateStory(
    started,
    toolEvent("tool_result", "run_commands", 1, "call-1")
  )
  const fallback = updateStory(
    completed,
    toolEvent("tool_result", "run_commands", 1)
  )

  assert.equal(fallback.agentActivities?.length, 1)
  assert.equal(fallback.agentActivities?.[0]?.status, "completed")
})

test("groups tools that overlap in the same iteration", () => {
  const firstStarted = updateStory(
    story(),
    toolEvent("tool_call", "run_commands", 1, "call-1")
  )
  const secondStarted = updateStory(
    firstStarted,
    toolEvent("tool_call", "fetch_web_content", 1, "call-2")
  )
  const activities = secondStarted.agentActivities ?? []

  assert.equal(activities.length, 2)
  assert.ok(activities[0]?.parallelGroupId)
  assert.equal(activities[0]?.parallelGroupId, activities[1]?.parallelGroupId)
  assert.deepEqual(
    secondStarted.agentActivityUpdates?.map((activity) => activity.id),
    ["tool-call-1", "tool-call-2"]
  )
})

test("keeps sequential tools in the same iteration ungrouped", () => {
  const firstStarted = updateStory(
    story(),
    toolEvent("tool_call", "run_commands", 1, "call-1")
  )
  const firstCompleted = updateStory(
    firstStarted,
    toolEvent("tool_result", "run_commands", 1, "call-1")
  )
  const secondStarted = updateStory(
    firstCompleted,
    toolEvent("tool_call", "fetch_web_content", 1, "call-2")
  )

  assert.equal(secondStarted.agentActivities?.length, 2)
  assert.equal(secondStarted.agentActivities?.[0]?.parallelGroupId, undefined)
  assert.equal(secondStarted.agentActivities?.[1]?.parallelGroupId, undefined)
})

function updateStory(story: UserStory, event: AgentEvent) {
  return { ...story, ...agentFlowUpdate(story, event) }
}

function toolEvent(
  hookEventName: "tool_call" | "tool_result",
  toolName: string,
  iteration: number,
  toolCallId?: string
): AgentEvent {
  return {
    payload: {
      hookEventName,
      iteration,
      toolCallId,
      toolName,
    },
    type: "tool",
  }
}

function story(): UserStory {
  return {
    createdAt: "2026-06-11T10:00:00.000Z",
    id: 1,
    owner: "Product",
    priority: "Medium",
    projectId: "project",
    status: "in-progress",
    summary: "",
    title: "Story",
  }
}
