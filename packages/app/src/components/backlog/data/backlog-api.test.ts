import assert from "node:assert/strict"
import test from "node:test"

import { BacklogApiError, createBacklogApi } from "./backlog-api.ts"
import { agentStoryTextLimit } from "./agent-update-limits.ts"

test("bounds agent text before sending a story update", async () => {
  const originalFetch = globalThis.fetch
  let requestBody: Record<string, unknown> = {}
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return Response.json({ data: story })
  }

  try {
    const api = createBacklogApi({ url: "http://localhost:3333/api/v1" })
    await api.update(story.id, {
      agentLastEvent: "x".repeat(agentStoryTextLimit + 500),
    })
    assert.equal(String(requestBody.agentLastEvent).length, agentStoryTextLimit)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("surfaces structured validation errors as non-retryable", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    Response.json(
      {
        errors: [
          {
            message:
              "The agentLastEvent field must not be greater than 4096 characters",
          },
        ],
      },
      { status: 422 }
    )

  try {
    const api = createBacklogApi({ url: "http://localhost:3333/api/v1" })
    await assert.rejects(
      api.update(story.id, { agentLastEvent: "invalid" }),
      (error) =>
        error instanceof BacklogApiError &&
        error.status === 422 &&
        !error.retryable &&
        error.message.includes("agentLastEvent")
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

const story = {
  agentRuns: [],
  codeSelectionAttachments: [],
  comments: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  fileAttachments: [],
  id: "story-1",
  owner: "Product",
  priority: "medium",
  projectId: "project-1",
  status: "in-progress",
  storyNumber: 1,
  summary: "Summary",
  title: "Title",
}
