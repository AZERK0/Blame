import type {
  UserStory,
  UserStoryActivityDetail,
  UserStoryAgentRun,
  UserStoryAgentRunDraft,
  UserStoryAgentRunUpdate,
  UserStoryComment,
  UserStoryDraft,
  UserStoryUpdate,
} from "@/components/backlog/data/backlog-data"
import type { ApiConnection } from "@/context/platform"

export function createBacklogApi(connection: ApiConnection) {
  const baseUrl = connection.url.replace(/\/$/, "")

  return {
    async list(projectId: string) {
      return userStoryList(
        await request<unknown>(
          connection,
          baseUrl,
          `/projects/user-stories?${new URLSearchParams({
            projectId,
            view: "summary",
          })}`
        ),
        { detail: false }
      )
    },
    async get(id: string) {
      return userStory(
        await request<unknown>(
          connection,
          baseUrl,
          `/projects/user-stories/${id}`
        )
      )
    },
    async create(input: UserStoryDraft) {
      return userStory(
        await request<unknown>(connection, baseUrl, "/projects/user-stories", {
          body: JSON.stringify(input),
          method: "POST",
        })
      )
    },
    async update(id: string, input: UserStoryUpdate) {
      return userStory(
        await request<unknown>(
          connection,
          baseUrl,
          `/projects/user-stories/${id}`,
          {
            body: JSON.stringify(apiUpdate(input)),
            method: "PATCH",
          }
        )
      )
    },
    async undoComment(
      id: string,
      commentId: string,
      input: { clineSessionId?: string; runId: string }
    ) {
      return userStory(
        await request<unknown>(
          connection,
          baseUrl,
          `/projects/user-stories/${id}/comments/${commentId}/undo`,
          {
            body: input ? JSON.stringify(input) : undefined,
            method: "POST",
          }
        )
      )
    },
    async validateCommentUndo(id: string, commentId: string, runId: string) {
      await request<unknown>(
        connection,
        baseUrl,
        `/projects/user-stories/${id}/comments/${commentId}/undo-validation`,
        { body: JSON.stringify({ runId }), method: "POST" }
      )
    },
    async activityDetail(id: string, activityId: string) {
      return activityDetail(
        await request<unknown>(
          connection,
          baseUrl,
          `/projects/user-stories/${id}/agent-activities/${encodeURIComponent(activityId)}`
        )
      )
    },
    async createAgentRun(id: string, input: UserStoryAgentRunDraft) {
      return userStoryAgentRun(
        await request<unknown>(
          connection,
          baseUrl,
          `/projects/user-stories/${id}/agent-runs`,
          {
            body: JSON.stringify(input),
            method: "POST",
          }
        )
      )
    },
    async updateAgentRun(
      id: string,
      runId: string,
      input: UserStoryAgentRunUpdate
    ) {
      return userStoryAgentRun(
        await request<unknown>(
          connection,
          baseUrl,
          `/projects/user-stories/${id}/agent-runs/${runId}`,
          {
            body: JSON.stringify(apiAgentRunUpdate(input)),
            method: "PATCH",
          }
        )
      )
    },
    async agentRunActivityDetail(
      id: string,
      runId: string,
      activityId: string
    ) {
      return activityDetail(
        await request<unknown>(
          connection,
          baseUrl,
          `/projects/user-stories/${id}/agent-runs/${runId}/activities/${encodeURIComponent(activityId)}`
        )
      )
    },
    async createComment(
      id: string,
      input: Pick<UserStoryComment, "body" | "codeSelectionAttachments">
    ) {
      return userStoryComment(
        await request<unknown>(
          connection,
          baseUrl,
          `/projects/user-stories/${id}/comments`,
          {
            body: JSON.stringify(input),
            method: "POST",
          }
        )
      )
    },
    async delete(id: string) {
      await request<void>(connection, baseUrl, `/projects/user-stories/${id}`, {
        method: "DELETE",
      })
    },
  }
}

function apiUpdate(input: UserStoryUpdate) {
  if (!input.agentActivity && !input.agentActivityUpdates) return input
  const { agentActivities, agentActivityUpdates, ...update } = input
  void agentActivities
  void agentActivityUpdates
  return update
}

function apiAgentRunUpdate(input: UserStoryAgentRunUpdate) {
  if (!input.agentActivity && !input.agentActivityUpdates) return input
  const { activities, agentActivityUpdates, ...update } = input
  void activities
  void agentActivityUpdates
  return update
}

function activityDetail(value: unknown) {
  if (!isRecord(value)) throw new Error("Unable to read agent activity detail.")
  if (typeof value.detail !== "string")
    throw new Error("Unable to read agent activity detail.")
  return value as UserStoryActivityDetail
}

function userStoryAgentRun(value: unknown) {
  const run = transformerValue(value)
  const id = stringId(recordValue(run).id)
  const userStoryId = stringId(recordValue(run).userStoryId)
  if (!isRecord(run)) throw new Error("Unable to read user story agent run.")
  if (id === undefined || userStoryId === undefined)
    throw new Error("Unable to read user story agent run.")
  if (typeof run.kind !== "string")
    throw new Error("Unable to read user story agent run.")
  if (typeof run.status !== "string")
    throw new Error("Unable to read user story agent run.")
  return {
    ...run,
    commentId: stringId(recordValue(run).commentId) ?? null,
    id,
    userStoryId,
  } as UserStoryAgentRun
}

function userStoryComment(value: unknown) {
  const comment = transformerValue(value)
  const id = stringId(recordValue(comment).id)
  const userStoryId = stringId(recordValue(comment).userStoryId)
  if (!isRecord(comment)) throw new Error("Unable to read user story comment.")
  if (id === undefined) throw new Error("Unable to read user story comment.")
  if (typeof comment.body !== "string")
    throw new Error("Unable to read user story comment.")
  return {
    author: typeof comment.author === "string" ? comment.author : "Product",
    body: comment.body,
    codeSelectionAttachments: codeSelectionAttachments(
      recordValue(comment).codeSelectionAttachments
    ),
    fileAttachments: fileAttachments(recordValue(comment).fileAttachments),
    createdAt:
      typeof comment.createdAt === "string"
        ? comment.createdAt
        : new Date().toISOString(),
    id,
    updatedAt: typeof comment.updatedAt === "string" ? comment.updatedAt : null,
    userStoryId: userStoryId ?? "",
  } satisfies UserStoryComment
}

function userStoryList(value: unknown, options: UserStoryOptions = {}) {
  if (Array.isArray(value)) return value.map((item) => userStory(item, options))
  if (!isRecord(value)) throw new Error("Unable to read user stories.")
  if ("data" in value) return userStoryList(value.data, options)
  throw new Error("Unable to read user stories.")
}

type UserStoryOptions = {
  detail?: boolean
}

function userStory(value: unknown, options: UserStoryOptions = {}) {
  const story = transformerValue(value)
  const id = stringId(recordValue(story).id)
  if (!isRecord(story)) throw new Error("Unable to read user story.")
  if (id === undefined) throw new Error("Unable to read user story.")
  if (typeof story.storyNumber !== "number")
    throw new Error("Unable to read user story.")
  if (typeof story.projectId !== "string")
    throw new Error("Unable to read user story.")
  if (typeof story.title !== "string")
    throw new Error("Unable to read user story.")
  const output = {
    ...story,
    id,
    storyNumber: story.storyNumber,
  } as UserStory
  if (options.detail !== false || "codeSelectionAttachments" in story) {
    output.codeSelectionAttachments = codeSelectionAttachments(
      recordValue(story).codeSelectionAttachments
    )
  }
  if (options.detail !== false || "fileAttachments" in story) {
    output.fileAttachments = fileAttachments(recordValue(story).fileAttachments)
  }
  if (Array.isArray(story.agentRuns)) {
    output.agentRuns = story.agentRuns.map(userStoryAgentRun)
  } else if (options.detail !== false) {
    output.agentRuns = []
  }
  if (Array.isArray(story.runningAgentRuns)) {
    output.runningAgentRuns = story.runningAgentRuns.map(userStoryAgentRun)
  }
  if (Array.isArray(story.comments)) {
    output.comments = story.comments.map(userStoryComment)
  } else if (options.detail !== false) {
    output.comments = []
  }
  return output
}

function codeSelectionAttachments(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter(codeSelectionAttachment)
}

function codeSelectionAttachment(value: unknown) {
  if (!isRecord(value)) return false
  return (
    typeof value.id === "string" &&
    typeof value.content === "string" &&
    typeof value.endLine === "number" &&
    typeof value.path === "string" &&
    typeof value.startLine === "number"
  )
}

function fileAttachments(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter(fileAttachment)
}

function fileAttachment(value: unknown) {
  if (!isRecord(value)) return false
  return (
    typeof value.id === "string" &&
    (!("aiContextMarkdown" in value) ||
      typeof value.aiContextMarkdown === "string") &&
    typeof value.content === "string" &&
    typeof value.name === "string" &&
    typeof value.size === "number" &&
    typeof value.type === "string"
  )
}

function transformerValue(value: unknown): unknown {
  if (!isRecord(value)) return value
  if ("data" in value) return transformerValue(value.data)
  if (!Array.isArray(value.transformerData)) return value
  return transformerValue(value.transformerData[0])
}

async function request<T>(
  connection: ApiConnection,
  baseUrl: string,
  path: string,
  init?: RequestInit
) {
  const headers = new Headers(init?.headers)
  headers.set("Accept", "application/json")
  headers.set("Content-Type", "application/json")
  if (connection.token)
    headers.set("Authorization", `Bearer ${connection.token}`)

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  })

  if (!response.ok) throw new Error(await responseMessage(response))
  if (response.status === 204) return undefined as T
  return unwrapResponse<T>(await response.json())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object"
}

function recordValue(value: unknown) {
  return isRecord(value) ? value : {}
}

function stringId(value: unknown) {
  if (typeof value !== "string") return undefined
  return value.trim() ? value : undefined
}

function unwrapResponse<T>(value: unknown) {
  if (isRecord(value) && "data" in value) return value.data as T
  return value as T
}

async function responseMessage(response: Response) {
  try {
    const body = await response.json()
    if (typeof body.message === "string") return body.message
  } catch {
    return `Request failed with status ${response.status}`
  }
  return `Request failed with status ${response.status}`
}
