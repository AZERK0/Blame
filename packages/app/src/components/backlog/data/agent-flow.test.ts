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

test("appends reasoning deltas while the agent is running", () => {
  const firstDelta = updateStory(story(), reasoningEvent({ text: "Now" }))
  const secondDelta = updateStory(firstDelta, reasoningEvent({ text: " I" }))
  const thirdDelta = updateStory(
    secondDelta,
    reasoningEvent({ text: " understand." })
  )

  assert.equal(thirdDelta.agentActivities?.length, 1)
  assert.equal(thirdDelta.agentActivities?.[0]?.detail, "Now I understand.")
})

test("replaces reasoning with accumulated text when it is available", () => {
  const firstDelta = updateStory(story(), reasoningEvent({ text: "Now" }))
  const accumulated = updateStory(
    firstDelta,
    reasoningEvent({ accumulatedText: "Now I understand." })
  )

  assert.equal(accumulated.agentActivities?.length, 1)
  assert.equal(accumulated.agentActivities?.[0]?.detail, "Now I understand.")
})

test("keeps assistant messages between tools", () => {
  const firstMessage = updateStory(story(), textEvent({ text: "Je vais" }))
  const completedMessage = updateStory(
    firstMessage,
    textEvent({ text: " inspecter." })
  )
  const toolStarted = updateStory(
    completedMessage,
    toolEvent("tool_call", "read_files", 1, "call-1")
  )
  const secondMessage = updateStory(
    toolStarted,
    textEvent({ text: "Je vais continuer." })
  )

  assert.deepEqual(
    secondMessage.agentActivities?.map((activity) => activity.kind),
    ["message", "tool", "message"]
  )
  assert.equal(secondMessage.agentActivities?.[0]?.detail, "Je vais inspecter.")
  assert.equal(secondMessage.agentActivities?.[2]?.detail, "Je vais continuer.")
})

test("marks a stopped assistant message as the final response", () => {
  const streaming = updateStory(story(), textEvent({ text: "Salut" }))
  const stopped = updateStory(
    streaming,
    textEvent({ accumulatedText: "Salut !", finishReason: "stop" })
  )
  const activity = stopped.agentActivities?.[0]

  assert.equal(stopped.agentActivities?.length, 1)
  assert.equal(activity?.kind, "message")
  assert.equal(activity?.messageKind, "final")
  assert.equal(activity?.title, "Agent response")
  assert.equal(activity?.detail, "Salut !")
})

function updateStory(story: UserStory, event: AgentEvent) {
  return { ...story, ...agentFlowUpdate(story, event) }
}

function reasoningEvent(payload: Record<string, unknown>): AgentEvent {
  return {
    payload,
    type: "reasoning",
  }
}

function textEvent(payload: Record<string, unknown>): AgentEvent {
  return {
    payload,
    type: "text",
  }
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
