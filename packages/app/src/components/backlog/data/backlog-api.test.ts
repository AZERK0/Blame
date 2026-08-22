import assert from "node:assert/strict"
import test from "node:test"

import { BacklogApiError, createBacklogApi } from "./backlog-api.ts"
import { type UserStoryDraft, userStoryReadyForAgent } from "./backlog-data.ts"
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

test("sends incremental activity updates as one bounded batch", async () => {
  const originalFetch = globalThis.fetch
  const requestBodies: Record<string, unknown>[] = []
  globalThis.fetch = async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)))
    return Response.json({
      data:
        requestBodies.length === 1
          ? story
          : {
              activities: activityUpdates,
              id: "run-1",
              kind: "initial",
              status: "running",
              userStoryId: story.id,
            },
    })
  }

  const activityUpdates = [
    {
      createdAt: "2026-08-22T12:00:00.000Z",
      detail: "Read source",
      id: "tool-read",
      kind: "tool" as const,
      status: "completed" as const,
      title: "Read",
    },
    {
      createdAt: "2026-08-22T12:00:01.000Z",
      detail: "Run tests",
      id: "tool-test",
      kind: "tool" as const,
      status: "running" as const,
      title: "Test",
    },
  ]

  try {
    const api = createBacklogApi({ url: "http://localhost:3333/api/v1" })
    await api.update(story.id, {
      agentActivities: activityUpdates,
      agentActivityUpdates: activityUpdates,
    })
    await api.updateAgentRun(story.id, "run-1", {
      activities: activityUpdates,
      agentActivityUpdates: activityUpdates,
    })

    assert.deepEqual(requestBodies, [
      { agentActivityUpdates: activityUpdates },
      { agentActivityUpdates: activityUpdates },
    ])
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

test("creates a queued story before uploading its attachments", async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ body?: string; method: string; url: string }> = []
  const attachment = {
    content: "SGVsbG8=",
    id: "attachment-id",
    name: "attachment.txt",
    size: 5,
    type: "text/plain",
  }
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    requests.push({
      body: typeof init?.body === "string" ? init.body : undefined,
      method: init?.method ?? "GET",
      url,
    })
    if (url.endsWith("/projects/user-stories") && init?.method === "POST") {
      return Response.json({
        data: {
          ...story,
          fileAttachmentUploadPending: true,
          status: "ready",
        },
      })
    }
    if (url.endsWith("/attachments/uploads")) {
      return Response.json({
        attachment: { ...attachment, content: undefined },
        upload: {
          expiresAt: "2026-07-25T12:15:00.000Z",
          headers: { "Content-Type": "text/plain" },
          url: "https://storage.example/upload",
        },
      })
    }
    if (url === "https://storage.example/upload") return new Response(null)
    if (url.endsWith("/attachments/attachment-id/complete")) {
      return Response.json({ ...attachment, content: undefined })
    }
    return Response.json({
      data: {
        ...story,
        fileAttachments: [{ ...attachment, content: undefined }],
        fileAttachmentUploadPending: false,
        status: "ready",
      },
    })
  }

  try {
    const api = createBacklogApi({ url: "http://localhost:3333/api/v1" })
    const input: UserStoryDraft = {
      fileAttachments: [attachment],
      projectId: "project-1",
      status: "ready",
      summary: "Summary",
      title: "Title",
    }
    const creation = await api.create(input)

    assert.equal(requests.length, 1)
    assert.equal(JSON.parse(requests[0]?.body ?? "{}").status, "ready")
    assert.equal(
      JSON.parse(requests[0]?.body ?? "{}").fileAttachmentUploadPending,
      true
    )
    assert.deepEqual(JSON.parse(requests[0]?.body ?? "{}").fileAttachments, [])
    assert.equal(creation.story.status, "ready")
    assert.equal(creation.story.fileAttachmentUploadStatus, "uploading")
    assert.equal(userStoryReadyForAgent(creation.story), true)
    assert.equal(
      userStoryReadyForAgent({
        ...creation.story,
        fileAttachments: [],
        fileAttachmentUploadStatus: undefined,
      }),
      false
    )
    assert.ok(creation.completeAttachmentUpload)

    const uploadedStory = await creation.completeAttachmentUpload()

    assert.deepEqual(
      requests.map(({ method, url }) => ({ method, url })),
      [
        {
          method: "POST",
          url: "http://localhost:3333/api/v1/projects/user-stories",
        },
        {
          method: "POST",
          url: "http://localhost:3333/api/v1/attachments/uploads",
        },
        { method: "PUT", url: "https://storage.example/upload" },
        {
          method: "POST",
          url: "http://localhost:3333/api/v1/attachments/attachment-id/complete",
        },
        {
          method: "PATCH",
          url: "http://localhost:3333/api/v1/projects/user-stories/story-1",
        },
      ]
    )
    assert.equal(userStoryReadyForAgent(uploadedStory), true)
    assert.equal(uploadedStory.fileAttachmentUploadPending, false)
    assert.deepEqual(JSON.parse(requests[4]?.body ?? "{}"), {
      fileAttachments: [
        {
          id: attachment.id,
          name: attachment.name,
          size: attachment.size,
          type: attachment.type,
        },
      ],
      fileAttachmentUploadPending: false,
    })
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
