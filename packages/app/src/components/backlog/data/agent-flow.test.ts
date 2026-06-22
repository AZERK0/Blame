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

test("starts a new assistant message after a text content block closes", () => {
  const firstMessage = updateStory(story(), textEvent({ text: "Plan rapide." }))
  const closedMessage = updateStory(
    firstMessage,
    textEvent({ phase: "finished", text: "Plan rapide." })
  )
  const secondMessage = updateStory(
    closedMessage,
    textEvent({ text: "Je continue." })
  )

  assert.deepEqual(
    secondMessage.agentActivities?.map((activity) => activity.kind),
    ["message", "message"]
  )
  assert.equal(secondMessage.agentActivities?.[0]?.detail, "Plan rapide.")
  assert.equal(secondMessage.agentActivities?.[0]?.status, "completed")
  assert.equal(secondMessage.agentActivities?.[1]?.detail, "Je continue.")
})

test("keeps cline assistant messages and tools in canonical order", () => {
  const plan = updateStory(story(), textEvent({ text: "Plan rapide." }))
  const firstTool = updateStory(
    plan,
    toolEvent("tool_call", "get_code_minimal_context", 1, "call-1")
  )
  const secondTool = updateStory(
    firstTool,
    toolEvent("tool_call", "run_commands", 1, "call-2")
  )
  const firstToolDone = updateStory(
    secondTool,
    toolEvent("tool_result", "get_code_minimal_context", 1, "call-1")
  )
  const secondToolDone = updateStory(
    firstToolDone,
    toolEvent("tool_result", "run_commands", 1, "call-2")
  )
  const bridgeMessage = updateStory(
    secondToolDone,
    textEvent({ text: "Je vais lire rapidement." })
  )
  const thirdTool = updateStory(
    bridgeMessage,
    toolEvent("tool_call", "read_files", 1, "call-3")
  )
  const fourthTool = updateStory(
    thirdTool,
    toolEvent("tool_call", "search_codebase", 1, "call-4")
  )
  const thirdToolDone = updateStory(
    fourthTool,
    toolEvent("tool_result", "read_files", 1, "call-3")
  )
  const fourthToolDone = updateStory(
    thirdToolDone,
    toolEvent("tool_result", "search_codebase", 1, "call-4")
  )
  const finalMessage = updateStory(
    fourthToolDone,
    textEvent({ text: "Franchement : base solide." })
  )
  const completed = updateStory(
    finalMessage,
    doneEvent("Franchement : base solide.")
  )

  assert.deepEqual(
    completed.agentActivities?.map((activity) => activity.kind),
    ["message", "tool", "tool", "message", "tool", "tool", "message"]
  )
  assert.equal(completed.agentActivities?.[0]?.detail, "Plan rapide.")
  assert.equal(
    completed.agentActivities?.[3]?.detail,
    "Je vais lire rapidement."
  )
  assert.equal(completed.agentActivities?.[6]?.title, "Agent response")
  assert.equal(
    completed.agentActivities?.[6]?.detail,
    "Franchement : base solide."
  )
})

test("does not move a done response into a middle message", () => {
  const message = updateStory(story(), textEvent({ text: "Plan rapide." }))
  const toolStarted = updateStory(
    message,
    toolEvent("tool_call", "run_commands", 1, "call-1")
  )
  const completed = updateStory(toolStarted, doneEvent("Réponse finale."))

  assert.deepEqual(
    completed.agentActivities?.map((activity) => activity.kind),
    ["message", "tool"]
  )
  assert.equal(completed.agentActivities?.[0]?.title, "Agent message")
  assert.equal(completed.agentActivities?.[0]?.detail, "Plan rapide.")
  assert.equal(completed.agentFinalResponse, "Réponse finale.")
})

test("starts a new assistant message from global accumulated text after a tool", () => {
  const firstMessage = updateStory(
    story(),
    textEvent({ accumulatedText: "Plan rapide." })
  )
  const toolStarted = updateStory(
    firstMessage,
    toolEvent("tool_call", "get_code_minimal_context", 1, "call-1")
  )
  const secondMessage = updateStory(
    toolStarted,
    textEvent({ accumulatedText: "Plan rapide.\n\nJe vois le diff." })
  )

  assert.deepEqual(
    secondMessage.agentActivities?.map((activity) => activity.kind),
    ["message", "tool", "message"]
  )
  assert.equal(secondMessage.agentActivities?.[0]?.detail, "Plan rapide.")
  assert.equal(secondMessage.agentActivities?.[2]?.detail, "Je vois le diff.")
})

test("keeps accumulated updates scoped to the current assistant message", () => {
  const firstMessage = updateStory(
    story(),
    textEvent({ accumulatedText: "Plan rapide." })
  )
  const toolStarted = updateStory(
    firstMessage,
    toolEvent("tool_call", "get_code_minimal_context", 1, "call-1")
  )
  const secondMessage = updateStory(
    toolStarted,
    textEvent({ accumulatedText: "Plan rapide.\n\nJe vois" })
  )
  const updatedSecondMessage = updateStory(
    secondMessage,
    textEvent({ accumulatedText: "Plan rapide.\n\nJe vois le diff." })
  )

  assert.deepEqual(
    updatedSecondMessage.agentActivities?.map((activity) => activity.kind),
    ["message", "tool", "message"]
  )
  assert.equal(updatedSecondMessage.agentActivities?.[0]?.detail, "Plan rapide.")
  assert.equal(
    updatedSecondMessage.agentActivities?.[2]?.detail,
    "Je vois le diff."
  )
})

test("deduplicates a repeated assistant message after tools", () => {
  const firstMessage = updateStory(
    story(),
    textEvent({ accumulatedText: "Je vais inspecter." })
  )
  const toolStarted = updateStory(
    firstMessage,
    toolEvent("tool_call", "read_files", 1, "call-1")
  )
  const repeatedMessage = updateStory(
    toolStarted,
    textEvent({ accumulatedText: "Je vais inspecter." })
  )

  assert.deepEqual(
    repeatedMessage.agentActivities?.map((activity) => activity.kind),
    ["message", "tool"]
  )
})

test("keeps repeated assistant text chunks when they are separate messages", () => {
  const firstMessage = updateStory(story(), textEvent({ text: "Ok." }))
  const toolStarted = updateStory(
    firstMessage,
    toolEvent("tool_call", "run_commands", 1, "call-1")
  )
  const secondMessage = updateStory(toolStarted, textEvent({ text: "Ok." }))

  assert.deepEqual(
    secondMessage.agentActivities?.map((activity) => activity.kind),
    ["message", "tool", "message"]
  )
  assert.equal(secondMessage.agentActivities?.[0]?.detail, "Ok.")
  assert.equal(secondMessage.agentActivities?.[2]?.detail, "Ok.")
})

test("completes a running tool when the next assistant message starts", () => {
  const toolStarted = updateStory(
    story(),
    toolEvent("tool_call", "read_files", 1, "call-1")
  )
  const message = updateStory(
    toolStarted,
    textEvent({ text: "Je continue après le tool." })
  )

  assert.deepEqual(
    message.agentActivities?.map((activity) => activity.status),
    ["completed", "running"]
  )
  assert.equal(message.agentActivities?.[0]?.kind, "tool")
  assert.equal(message.agentActivities?.[1]?.kind, "message")
})

test("completes a running tool when the run finishes", () => {
  const toolStarted = updateStory(
    story(),
    toolEvent("tool_call", "read_files", 1, "call-1")
  )
  const completed = updateStory(toolStarted, doneEvent())

  assert.equal(completed.agentActivities?.length, 1)
  assert.equal(completed.agentActivities?.[0]?.kind, "tool")
  assert.equal(completed.agentActivities?.[0]?.status, "completed")
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

test("promotes a streamed message when the done response matches it", () => {
  const streaming = updateStory(story(), textEvent({ text: "Salut !" }))
  const completed = updateStory(streaming, doneEvent("Salut !"))
  const activity = completed.agentActivities?.[0]

  assert.equal(completed.agentFinalResponse, "Salut !")
  assert.equal(completed.agentActivities?.length, 1)
  assert.equal(activity?.kind, "message")
  assert.equal(activity?.messageKind, "final")
  assert.equal(activity?.title, "Agent response")
  assert.deepEqual(
    completed.agentActivityUpdates?.map((update) => update.id),
    ["message-session-1"]
  )
})

test("promotes a partial streamed message to the full final response", () => {
  const streaming = updateStory(story(), textEvent({ text: "Salut" }))
  const completed = updateStory(
    streaming,
    doneEvent("Salut !\n\nLa reponse complete.")
  )
  const activity = completed.agentActivities?.[0]

  assert.equal(completed.agentFinalResponse, "Salut !\n\nLa reponse complete.")
  assert.equal(completed.agentActivities?.length, 1)
  assert.equal(activity?.kind, "message")
  assert.equal(activity?.messageKind, "final")
  assert.equal(activity?.title, "Agent response")
  assert.equal(activity?.detail, "Salut !\n\nLa reponse complete.")
  assert.deepEqual(
    completed.agentActivityUpdates?.map((update) => update.id),
    ["message-session-1"]
  )
})

test("repairs a malformed streamed final response from the done text", () => {
  const streamedText =
    "Oui — globalement la codebase a l’air propre et assez bien structurée.\n\n" +
    "Monorepo clair : backend,/frontend etpackages/shared."
  const finalText =
    "Oui — globalement la codebase a l’air propre et assez bien structurée.\n\n" +
    "Monorepo clair : backend, frontend et packages/shared."
  const streaming = updateStory(story(), textEvent({ text: streamedText }))
  const completed = updateStory(streaming, doneEvent(finalText))
  const activity = completed.agentActivities?.[0]

  assert.equal(completed.agentFinalResponse, finalText)
  assert.equal(completed.agentActivities?.length, 1)
  assert.equal(activity?.kind, "message")
  assert.equal(activity?.messageKind, "final")
  assert.equal(activity?.title, "Agent response")
  assert.equal(activity?.detail, finalText)
  assert.deepEqual(
    completed.agentActivityUpdates?.map((update) => update.id),
    ["message-session-1"]
  )
})

test("uses the latest streamed message as the final response when done has no text", () => {
  const firstMessage = updateStory(
    story(),
    textEvent({ text: "Je vais inspecter." })
  )
  const toolStarted = updateStory(
    firstMessage,
    toolEvent("tool_call", "read_files", 1, "call-1")
  )
  const finalMessage = updateStory(
    toolStarted,
    textEvent({ text: "Review rapide de la codebase." })
  )
  const completed = updateStory(finalMessage, doneEvent())
  const activity = completed.agentActivities?.at(-1)

  assert.equal(completed.agentFinalResponse, "Review rapide de la codebase.")
  assert.equal(activity?.kind, "message")
  assert.equal(activity?.messageKind, "final")
  assert.equal(activity?.title, "Agent response")
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

function doneEvent(text?: string): AgentEvent {
  return {
    payload: text === undefined ? {} : { text },
    type: "done",
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
