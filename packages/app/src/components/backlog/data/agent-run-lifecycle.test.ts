import assert from "node:assert/strict"
import test from "node:test"

import {
  agentRunFinalization,
  agentRunOwnsStory,
  agentUpdateKey,
  agentEventMatchesExecution,
} from "./agent-run-lifecycle.ts"
import { resumableAgentFailure } from "./agent-flow.ts"
import type { UserStory, UserStoryAgentRun } from "./backlog-data.ts"

test("only the explicitly active run owns story lifecycle updates", () => {
  const first = run("run-1")
  const second = run("run-2")
  const story = userStory([first, second], second.id)

  assert.equal(agentRunOwnsStory(story, first), false)
  assert.equal(agentRunOwnsStory(story, second), true)
  assert.equal(agentUpdateKey(story, first), first.id)
  assert.equal(agentUpdateKey(story, second), second.id)
})

test("a story with no active run rejects every run update", () => {
  const currentRun = run("run-1")
  const story = userStory([currentRun], null)

  assert.equal(agentRunOwnsStory(story, currentRun), false)
})

test("uses the latest running run for legacy story payloads", () => {
  const first = run("run-1")
  const second = run("run-2")
  const story = userStory([first, second], undefined)

  assert.equal(agentRunOwnsStory(story, first), false)
  assert.equal(agentRunOwnsStory(story, second), true)
})

test("builds one terminal command from story and run updates", () => {
  const finalization = agentRunFinalization(
    [],
    {
      agentFinalResponse: "Final response",
      agentLastError: null,
      agentLastEvent: "Ready for review",
      status: "in-review",
    },
    {
      completedAt: "2026-08-22T00:00:00.000Z",
      status: "completed",
    }
  )

  assert.deepEqual(finalization, {
    activities: [],
    agentLastError: null,
    agentLastEvent: "Ready for review",
    completedAt: "2026-08-22T00:00:00.000Z",
    diffEndRef: undefined,
    finalResponse: "Final response",
    outcome: "review",
    sessionSummary: undefined,
    status: "completed",
    usage: undefined,
  })
})

test("keeps iteration-limit runs resumable", () => {
  const finalization = agentRunFinalization(
    [],
    {
      agentLastError: "Agent runtime exceeded maxIterations (512)",
      agentLastEvent: "Agent session failed",
      agentStatus: "Paused",
      status: "in-progress",
    },
    {
      completedAt: "2026-08-22T00:00:00.000Z",
      status: "failed",
    },
    "paused"
  )

  assert.equal(finalization?.outcome, "paused")
  assert.equal(finalization?.status, "failed")
})

test("terminal finalization closes every still-running activity", () => {
  const completedAt = "2026-08-22T00:01:00.000Z"
  const finalization = agentRunFinalization(
    [
      activity("reasoning-36-1", "reasoning"),
      activity("tool-64", "tool"),
      { ...activity("message-1", "message"), status: "completed" },
    ],
    { status: "in-progress" },
    { completedAt, status: "cancelled" }
  )

  assert.deepEqual(
    finalization?.activities.map(({ id, status, updatedAt }) => ({
      id,
      status,
      updatedAt,
    })),
    [
      { id: "reasoning-36-1", status: "completed", updatedAt: completedAt },
      { id: "tool-64", status: "failed", updatedAt: completedAt },
      { id: "message-1", status: "completed", updatedAt: undefined },
    ]
  )
})

test("rejects events tagged for another execution", () => {
  const event = {
    executionId: "execution-1",
    payload: {},
    type: "done" as const,
  }

  assert.equal(agentEventMatchesExecution(event, "execution-1"), true)
  assert.equal(agentEventMatchesExecution(event, "execution-2"), false)
  assert.equal(
    agentEventMatchesExecution(
      { ...event, executionId: undefined },
      "execution-2"
    ),
    false
  )
})

test("recognizes iteration limits as resumable agent failures", () => {
  assert.equal(
    resumableAgentFailure("Agent runtime exceeded maxIterations (512)"),
    true
  )
  assert.equal(resumableAgentFailure("Provider unavailable"), false)
})

function userStory(
  agentRuns: UserStoryAgentRun[],
  activeAgentRunId: string | null | undefined
) {
  return {
    activeAgentRunId,
    agentRuns,
    createdAt: "2026-08-22T00:00:00.000Z",
    id: "story-1",
    owner: "Product",
    priority: "Medium",
    projectId: "project-1",
    status: "in-progress",
    storyNumber: 1,
    summary: "",
    title: "Story",
  } satisfies UserStory
}

function run(id: string): UserStoryAgentRun {
  return {
    createdAt: `2026-08-22T00:00:0${id.endsWith("2") ? "2" : "1"}.000Z`,
    id,
    kind: "resume",
    status: "running",
    userStoryId: "story-1",
  }
}

function activity(id: string, kind: "message" | "reasoning" | "tool") {
  return {
    createdAt: "2026-08-22T00:00:00.000Z",
    detail: id,
    id,
    kind,
    status: "running" as const,
    title: id,
  }
}
