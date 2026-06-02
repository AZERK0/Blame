import type {
  UserStory,
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
          `/projects/user-stories?${new URLSearchParams({ projectId })}`
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
    async update(id: number, input: UserStoryUpdate) {
      return userStory(
        await request<unknown>(
          connection,
          baseUrl,
          `/projects/user-stories/${id}`,
          {
            body: JSON.stringify(input),
            method: "PATCH",
          }
        )
      )
    },
    async createComment(id: number, input: { body: string }) {
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
    async delete(id: number) {
      await request<void>(connection, baseUrl, `/projects/user-stories/${id}`, {
        method: "DELETE",
      })
    },
  }
}

function userStoryComment(value: unknown) {
  const comment = transformerValue(value)
  if (!isRecord(comment)) throw new Error("Unable to read user story comment.")
  if (typeof comment.id !== "number")
    throw new Error("Unable to read user story comment.")
  if (typeof comment.body !== "string")
    throw new Error("Unable to read user story comment.")
  return comment as UserStoryComment
}

function userStoryList(value: unknown) {
  if (Array.isArray(value)) return value.map(userStory)
  if (!isRecord(value)) throw new Error("Unable to read user stories.")
  if ("data" in value) return userStoryList(value.data)
  throw new Error("Unable to read user stories.")
}

function userStory(value: unknown) {
  const story = transformerValue(value)
  if (!isRecord(story)) throw new Error("Unable to read user story.")
  if (typeof story.id !== "number")
    throw new Error("Unable to read user story.")
  if (typeof story.projectId !== "string")
    throw new Error("Unable to read user story.")
  if (typeof story.title !== "string")
    throw new Error("Unable to read user story.")
  return story as UserStory
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
