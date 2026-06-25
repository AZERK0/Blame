import type {
  QuickChat,
  QuickChatActivityDetail,
  QuickChatAgentRun,
  QuickChatAgentRunDraft,
  QuickChatAgentRunUpdate,
  QuickChatDraft,
  QuickChatMessage,
  QuickChatMessageDraft,
  QuickChatUpdate,
} from "@/components/chat/data/quick-chat-data"
import type { useCloudAuth } from "@/context/cloud-auth"

type ApiConnection = ReturnType<typeof useCloudAuth>["apiConnection"]

export function createQuickChatApi(connection: ApiConnection) {
  const baseUrl = connection.url.replace(/\/$/, "")

  return {
    async list(projectId: string) {
      return quickChatList(
        await request<unknown>(
          connection,
          baseUrl,
          `/projects/quick-chats?${new URLSearchParams({ projectId })}`
        )
      )
    },
    async create(input: QuickChatDraft) {
      return quickChat(
        await request<unknown>(connection, baseUrl, "/projects/quick-chats", {
          body: JSON.stringify(input),
          method: "POST",
        })
      )
    },
    async update(id: number, input: QuickChatUpdate) {
      return quickChat(
        await request<unknown>(
          connection,
          baseUrl,
          `/projects/quick-chats/${id}`,
          {
            body: JSON.stringify(apiUpdate(input)),
            method: "PATCH",
          }
        )
      )
    },
    async createMessage(id: number, input: QuickChatMessageDraft) {
      return quickChatMessage(
        await request<unknown>(
          connection,
          baseUrl,
          `/projects/quick-chats/${id}/messages`,
          {
            body: JSON.stringify(input),
            method: "POST",
          }
        )
      )
    },
    async createAgentRun(id: number, input: QuickChatAgentRunDraft) {
      return quickChatAgentRun(
        await request<unknown>(
          connection,
          baseUrl,
          `/projects/quick-chats/${id}/agent-runs`,
          {
            body: JSON.stringify(input),
            method: "POST",
          }
        )
      )
    },
    async updateAgentRun(
      id: number,
      runId: number,
      input: QuickChatAgentRunUpdate
    ) {
      return quickChatAgentRun(
        await request<unknown>(
          connection,
          baseUrl,
          `/projects/quick-chats/${id}/agent-runs/${runId}`,
          {
            body: JSON.stringify(apiAgentRunUpdate(input)),
            method: "PATCH",
          }
        )
      )
    },
    async agentRunActivityDetail(
      id: number,
      runId: number,
      activityId: string
    ) {
      return activityDetail(
        await request<unknown>(
          connection,
          baseUrl,
          `/projects/quick-chats/${id}/agent-runs/${runId}/activities/${encodeURIComponent(activityId)}`
        )
      )
    },
    async delete(id: number) {
      await request<void>(connection, baseUrl, `/projects/quick-chats/${id}`, {
        method: "DELETE",
      })
    },
  }
}

function apiUpdate(input: QuickChatUpdate) {
  if (!input.agentActivity && !input.agentActivityUpdates) return input
  const { agentActivities, agentActivityUpdates, ...update } = input
  void agentActivities
  void agentActivityUpdates
  return update
}

function apiAgentRunUpdate(input: QuickChatAgentRunUpdate) {
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
  return value as QuickChatActivityDetail
}

function quickChatList(value: unknown) {
  if (Array.isArray(value)) return value.map(quickChat)
  if (!isRecord(value)) throw new Error("Unable to read quick chats.")
  if ("data" in value) return quickChatList(value.data)
  throw new Error("Unable to read quick chats.")
}

function quickChat(value: unknown) {
  const chat = transformerValue(value)
  const id = numericId(recordValue(chat).id)
  if (!isRecord(chat)) throw new Error("Unable to read quick chat.")
  if (id === undefined) throw new Error("Unable to read quick chat.")
  if (typeof chat.projectId !== "string")
    throw new Error("Unable to read quick chat.")
  if (typeof chat.title !== "string")
    throw new Error("Unable to read quick chat.")
  return {
    ...chat,
    agentRuns: Array.isArray(chat.agentRuns)
      ? chat.agentRuns.map(quickChatAgentRun)
      : [],
    id,
    messages: Array.isArray(chat.messages)
      ? chat.messages.map(quickChatMessage)
      : [],
  } as QuickChat
}

function quickChatMessage(value: unknown) {
  const message = transformerValue(value)
  const id = numericId(recordValue(message).id)
  const quickChatId = numericId(recordValue(message).quickChatId)
  if (!isRecord(message)) throw new Error("Unable to read quick chat message.")
  if (id === undefined || quickChatId === undefined)
    throw new Error("Unable to read quick chat message.")
  if (typeof message.body !== "string")
    throw new Error("Unable to read quick chat message.")
  return {
    ...message,
    author: typeof message.author === "string" ? message.author : "You",
    createdAt:
      typeof message.createdAt === "string"
        ? message.createdAt
        : new Date().toISOString(),
    id,
    quickChatId,
  } as QuickChatMessage
}

function quickChatAgentRun(value: unknown) {
  const run = transformerValue(value)
  const id = numericId(recordValue(run).id)
  const quickChatId = numericId(recordValue(run).quickChatId)
  if (!isRecord(run)) throw new Error("Unable to read quick chat agent run.")
  if (id === undefined || quickChatId === undefined)
    throw new Error("Unable to read quick chat agent run.")
  if (typeof run.kind !== "string")
    throw new Error("Unable to read quick chat agent run.")
  if (typeof run.status !== "string")
    throw new Error("Unable to read quick chat agent run.")
  return { ...run, id, quickChatId } as QuickChatAgentRun
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
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${connection.token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  })
  if (!response.ok) throw new Error(await responseMessage(response))
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

async function responseMessage(response: Response) {
  try {
    const payload = await response.json()
    if (isRecord(payload) && typeof payload.message === "string")
      return payload.message
  } catch {
    return response.statusText
  }
  return response.statusText
}

function numericId(value: unknown) {
  if (typeof value === "number") return value
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
}

function recordValue(value: unknown) {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object")
}
