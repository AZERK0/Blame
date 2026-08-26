import type {
  QuickChat,
  QuickChatAgentRun,
  QuickChatMessage,
} from "@/components/chat/data/quick-chat-data"
import { mergeAgentActivities } from "../../backlog/data/agent-activity-merge.ts"

export function mergeLoadedQuickChats(
  currentChats: QuickChat[],
  loadedChats: QuickChat[]
) {
  const currentById = new Map(currentChats.map((chat) => [chat.id, chat]))
  return loadedChats.map((chat) => {
    const currentChat = currentById.get(chat.id)
    return currentChat ? mergeQuickChat(currentChat, chat) : chat
  })
}

export function mergeQuickChat(
  currentChat: QuickChat,
  serverChat: QuickChat,
  options: { replaceAgentActivities?: boolean } = {}
) {
  const newestChat = newestValue(currentChat, serverChat)
  return {
    ...newestChat,
    agentActivities: options.replaceAgentActivities
      ? serverChat.agentActivities
      : mergeAgentActivities(
          currentChat.agentActivities ?? [],
          serverChat.agentActivities ?? []
        ),
    agentFinalResponse: providedValue(
      newestChat.agentFinalResponse,
      currentChat.agentFinalResponse
    ),
    agentRuns: mergeAgentRuns(
      currentChat.agentRuns ?? [],
      serverChat.agentRuns ?? []
    ),
    agentSessionSummary: providedValue(
      newestChat.agentSessionSummary,
      currentChat.agentSessionSummary
    ),
    agentUsage: providedValue(newestChat.agentUsage, currentChat.agentUsage),
    messages: mergeMessages(
      currentChat.messages ?? [],
      serverChat.messages ?? []
    ),
  }
}

export function mergeQuickChatAgentRun(
  chat: QuickChat,
  serverRun: QuickChatAgentRun
) {
  const currentRuns = chat.agentRuns ?? []
  const currentRun = currentRuns.find((run) => run.id === serverRun.id)
  const nextRun = currentRun ? mergeAgentRun(currentRun, serverRun) : serverRun
  return {
    ...chat,
    agentRuns: currentRun
      ? currentRuns.map((run) => (run.id === serverRun.id ? nextRun : run))
      : sortedByCreatedAt([...currentRuns, nextRun]),
  }
}

export function quickChatWithMessage(
  chat: QuickChat,
  message: QuickChatMessage
) {
  return {
    ...chat,
    messages: sortedByCreatedAt([...(chat.messages ?? []), message]),
  }
}

function mergeMessages(
  currentMessages: QuickChatMessage[],
  serverMessages: QuickChatMessage[]
) {
  return sortedByCreatedAt(mergeById(currentMessages, serverMessages))
}

function mergeAgentRuns(
  currentRuns: QuickChatAgentRun[],
  serverRuns: QuickChatAgentRun[]
) {
  const runs = new Map(currentRuns.map((run) => [run.id, run]))
  serverRuns.forEach((serverRun) => {
    const currentRun = runs.get(serverRun.id)
    runs.set(
      serverRun.id,
      currentRun ? mergeAgentRun(currentRun, serverRun) : serverRun
    )
  })
  return sortedByCreatedAt([...runs.values()])
}

function mergeAgentRun(
  currentRun: QuickChatAgentRun,
  serverRun: QuickChatAgentRun
) {
  const serverIsStale = staleRunSnapshot(currentRun, serverRun)
  const newestRun = serverIsStale
    ? currentRun
    : newestValue(currentRun, serverRun)
  return {
    ...newestRun,
    activities: mergeAgentActivities(
      currentRun.activities ?? [],
      mergeableServerActivities(currentRun, serverRun, serverIsStale)
    ),
    finalResponse: newestDefined(
      newestRun.finalResponse,
      currentRun.finalResponse,
      serverRun.finalResponse
    ),
    sessionSummary: newestDefined(
      newestRun.sessionSummary,
      currentRun.sessionSummary,
      serverRun.sessionSummary
    ),
    usage: newestDefined(newestRun.usage, currentRun.usage, serverRun.usage),
    status: monotonicRunStatus(currentRun, serverRun, newestRun),
  }
}

function monotonicRunStatus(
  currentRun: QuickChatAgentRun,
  serverRun: QuickChatAgentRun,
  newestRun: QuickChatAgentRun
) {
  if (terminalRunStatus(currentRun.status)) return currentRun.status
  if (terminalRunStatus(serverRun.status)) return serverRun.status
  if (currentRun.status === "running" || serverRun.status === "running")
    return "running"
  return newestRun.status
}

function staleRunSnapshot(
  currentRun: QuickChatAgentRun,
  serverRun: QuickChatAgentRun
) {
  return (
    typeof currentRun.lastSequenceNumber === "number" &&
    typeof serverRun.lastSequenceNumber === "number" &&
    serverRun.lastSequenceNumber < currentRun.lastSequenceNumber
  )
}

function mergeableServerActivities(
  currentRun: QuickChatAgentRun,
  serverRun: QuickChatAgentRun,
  serverIsStale: boolean
) {
  if (!serverIsStale) return serverRun.activities ?? []
  const currentIds = new Set(
    (currentRun.activities ?? []).map((activity) => activity.id)
  )
  return (serverRun.activities ?? []).filter(
    (activity) => !currentIds.has(activity.id)
  )
}

function terminalRunStatus(status: QuickChatAgentRun["status"]) {
  return status === "completed" || status === "failed" || status === "cancelled"
}

function newestDefined<T>(...values: (T | null | undefined)[]) {
  return values.find((value) => value !== null && value !== undefined) ?? null
}

function providedValue<T>(value: T | undefined, fallback: T | undefined) {
  return value === undefined ? fallback : value
}

function mergeById<T extends { id: number | string }>(
  currentItems: T[],
  serverItems: T[]
) {
  const items = new Map(currentItems.map((item) => [item.id, item]))
  serverItems.forEach((item) => items.set(item.id, item))
  return [...items.values()]
}

function newestValue<T extends { updatedAt?: string | null }>(
  currentValue: T,
  serverValue: T
) {
  const currentUpdatedAt = timestamp(currentValue.updatedAt)
  const serverUpdatedAt = timestamp(serverValue.updatedAt)
  if (serverUpdatedAt === undefined) return currentValue
  if (currentUpdatedAt === undefined || serverUpdatedAt >= currentUpdatedAt) {
    return serverValue
  }
  return currentValue
}

function sortedByCreatedAt<T extends { createdAt: string }>(items: T[]) {
  return [...items].sort(
    (left, right) =>
      (timestamp(left.createdAt) ?? 0) - (timestamp(right.createdAt) ?? 0)
  )
}

function timestamp(value: string | null | undefined) {
  if (!value) return undefined
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : date
}
