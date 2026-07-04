import * as React from "react"

import { createQuickChatApi } from "@/components/chat/data/quick-chat-api"
import {
  mergeLoadedQuickChats,
  mergeQuickChat,
  mergeQuickChatAgentRun,
  quickChatWithMessage,
} from "@/components/chat/data/quick-chat-store-merge"
import type {
  QuickChat,
  QuickChatAgentRun,
  QuickChatAgentRunDraft,
  QuickChatAgentRunUpdate,
  QuickChatDraft,
  QuickChatMessageDraft,
  QuickChatUpdate,
} from "@/components/chat/data/quick-chat-data"
import type { UserStoryAgentActivity } from "@/components/backlog/data/backlog-data"
import { useCloudAuth } from "@/context/cloud-auth"
import { useProjects } from "@/context/projects"

type QuickChatState = {
  activeId?: number
  chats: QuickChat[]
  detailedChatIds: Set<number>
  error?: string
  loading: boolean
  projectId?: string
}

type QuickChatStoreValue = ReturnType<typeof useQuickChatStoreValue>

const QuickChatStoreContext = React.createContext<
  QuickChatStoreValue | undefined
>(undefined)

export function QuickChatStoreProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const value = useQuickChatStoreValue()

  return React.createElement(QuickChatStoreContext.Provider, { value }, children)
}

export function useQuickChatStore() {
  const context = React.useContext(QuickChatStoreContext)
  if (!context)
    throw new Error(
      "useQuickChatStore must be used within QuickChatStoreProvider"
    )
  return context
}

function useQuickChatStoreValue() {
  const auth = useCloudAuth()
  const projects = useProjects()
  const [state, setState] = React.useState<QuickChatState>({
    chats: [],
    detailedChatIds: new Set(),
    loading: false,
  })
  const detailRequests = React.useRef(new Map<number, Promise<QuickChat>>())
  const loadRequestId = React.useRef(0)
  const updateQueues = React.useRef(new Map<number, Promise<unknown>>())
  const projectId = projects.activeProject?.id
  const projectPath = projects.activeProject?.path
  const api = React.useMemo(
    () => createQuickChatApi(auth.apiConnection),
    [auth.apiConnection]
  )

  const load = React.useCallback(async () => {
    const requestId = ++loadRequestId.current
    if (!projectId) {
      setState({
        chats: [],
        detailedChatIds: new Set(),
        loading: false,
        projectId: undefined,
      })
      return
    }
    setState((current) => loadingState(current, projectId))
    try {
      const loadedChats = await api.list(projectId)
      if (loadRequestId.current !== requestId) return
      setState((current) => {
        const chats = mergeLoadedQuickChats(current.chats, loadedChats)
        return {
          ...current,
          activeId: activeQuickChatId(current.activeId, chats),
          chats,
          error: undefined,
          loading: false,
          projectId,
        }
      })
    } catch (error) {
      if (loadRequestId.current !== requestId) return
      setState({
        chats: [],
        detailedChatIds: new Set(),
        error:
          error instanceof Error
            ? error.message
            : "Unable to load quick chats.",
        loading: false,
        projectId,
      })
    }
  }, [api, projectId])

  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => {
      window.clearTimeout(timer)
      loadRequestId.current += 1
    }
  }, [load])

  const create = React.useCallback(
    async (input: Omit<QuickChatDraft, "projectId">) => {
      if (!projectId) throw new Error("Open a project before creating a chat.")
      const chat = await api.create({ ...input, projectId })
      setState((current) => ({
        ...current,
        activeId: chat.id,
        chats: [chat, ...current.chats],
        detailedChatIds: chatStateIds(current.detailedChatIds, chat.id, true),
      }))
      return chat
    },
    [api, projectId]
  )

  const update = React.useCallback(
    async (chat: QuickChat, input: QuickChatUpdate) => {
      const previousUpdate =
        updateQueues.current.get(chat.id) ?? Promise.resolve()
      const nextUpdate = previousUpdate
        .catch(() => undefined)
        .then(async () => {
          const nextChat = await api.update(chat.id, input)
          setState((current) => ({
            ...current,
            chats: current.chats.map((currentChat) =>
              currentChat.id === chat.id
                ? mergeQuickChat(currentChat, nextChat)
                : currentChat
            ),
            detailedChatIds: chatStateIds(
              current.detailedChatIds,
              nextChat.id,
              true
            ),
          }))
          return nextChat
        })
      updateQueues.current.set(chat.id, nextUpdate)
      try {
        return await nextUpdate
      } finally {
        if (updateQueues.current.get(chat.id) === nextUpdate) {
          updateQueues.current.delete(chat.id)
        }
      }
    },
    [api]
  )

  const createMessage = React.useCallback(
    async (chat: QuickChat, input: QuickChatMessageDraft) => {
      const message = await api.createMessage(chat.id, input)
      setState((current) => ({
        ...current,
        chats: current.chats.map((currentChat) =>
          currentChat.id === chat.id
            ? quickChatWithMessage(currentChat, message)
            : currentChat
        ),
        detailedChatIds: chatStateIds(current.detailedChatIds, chat.id, true),
      }))
      return message
    },
    [api]
  )

  const createAgentRun = React.useCallback(
    async (chat: QuickChat, input: QuickChatAgentRunDraft) => {
      const run = await api.createAgentRun(chat.id, input)
      setState((current) => ({
        ...current,
        chats: current.chats.map((currentChat) =>
          currentChat.id === chat.id
            ? mergeQuickChatAgentRun(currentChat, run)
            : currentChat
        ),
        detailedChatIds: chatStateIds(current.detailedChatIds, chat.id, true),
      }))
      return run
    },
    [api]
  )

  const updateAgentRun = React.useCallback(
    async (
      chat: QuickChat,
      run: QuickChatAgentRun,
      input: QuickChatAgentRunUpdate
    ) => {
      const nextRun = await api.updateAgentRun(chat.id, run.id, input)
      setState((current) => ({
        ...current,
        chats: current.chats.map((currentChat) =>
          currentChat.id === chat.id
            ? mergeQuickChatAgentRun(currentChat, nextRun)
            : currentChat
        ),
      }))
      return nextRun
    },
    [api]
  )

  const updateAgentRunLocal = React.useCallback(
    (
      chat: QuickChat,
      run: QuickChatAgentRun,
      input: QuickChatAgentRunUpdate
    ) => {
      let nextRun = agentRunWithUpdate(run, input)
      setState((current) => ({
        ...current,
        chats: current.chats.map((currentChat) =>
          quickChatWithLocallyUpdatedAgentRun(currentChat, chat, run, input, {
            onNextRun(run) {
              nextRun = run
            },
          })
        ),
      }))
      return nextRun
    },
    []
  )

  const loadDetail = React.useCallback(
    async (chat: Pick<QuickChat, "id">) => {
      const existingRequest = detailRequests.current.get(chat.id)
      if (existingRequest) return existingRequest
      const request = api
        .get(chat.id)
        .then((loadedChat) => {
          setState((current) => ({
            ...current,
            chats: current.chats.map((currentChat) =>
              currentChat.id === loadedChat.id
                ? mergeQuickChat(currentChat, loadedChat)
                : currentChat
            ),
            detailedChatIds: chatStateIds(
              current.detailedChatIds,
              loadedChat.id,
              true
            ),
          }))
          return loadedChat
        })
        .finally(() => {
          detailRequests.current.delete(chat.id)
        })
      detailRequests.current.set(chat.id, request)
      return request
    },
    [api]
  )

  const agentRunActivityDetail = React.useCallback(
    async (
      chat: QuickChat,
      run: Pick<QuickChatAgentRun, "id">,
      activity: UserStoryAgentActivity
    ) => {
      const detail = await api.agentRunActivityDetail(
        chat.id,
        run.id,
        activity.id
      )
      return detail.detail
    },
    [api]
  )

  const updateLocal = React.useCallback(
    (chat: QuickChat, input: QuickChatUpdate) => {
      setState((current) => ({
        ...current,
        chats: current.chats.map((currentChat) =>
          currentChat.id === chat.id
            ? { ...currentChat, ...definedUpdate(input) }
            : currentChat
        ),
      }))
    },
    []
  )

  const remove = React.useCallback(
    async (chat: QuickChat) => {
      await api.delete(chat.id)
      setState((current) => ({
        ...current,
        activeId:
          current.activeId === chat.id
            ? current.chats.find((item) => item.id !== chat.id)?.id
            : current.activeId,
        chats: current.chats.filter(
          (currentChat) => currentChat.id !== chat.id
        ),
        detailedChatIds: chatStateIds(current.detailedChatIds, chat.id, false),
      }))
    },
    [api]
  )

  const setActiveId = React.useCallback((activeId: number | undefined) => {
    setState((current) => ({ ...current, activeId }))
  }, [])

  return {
    ...state,
    activeChat:
      state.chats.find((chat) => chat.id === state.activeId) ?? state.chats[0],
    agentRunActivityDetail,
    chatDetailsLoaded: (chat?: Pick<QuickChat, "id">) =>
      Boolean(chat && state.detailedChatIds?.has(chat.id)),
    create,
    createAgentRun,
    createMessage,
    load,
    loadDetail,
    projectId,
    projectPath,
    remove,
    setActiveId,
    update,
    updateAgentRun,
    updateAgentRunLocal,
    updateLocal,
  }
}

function activeQuickChatId(activeId: number | undefined, chats: QuickChat[]) {
  if (activeId && chats.some((chat) => chat.id === activeId)) return activeId
  return chats[0]?.id
}

function agentRunWithUpdate(
  run: QuickChatAgentRun,
  input: QuickChatAgentRunUpdate
) {
  const { agentActivity, agentActivityUpdates, ...metadata } = input
  const nextRun = { ...run, ...definedUpdate(metadata) }
  const activities = agentActivityUpdates ?? activityUpdateList(agentActivity)
  if (!activities.length) return nextRun
  return {
    ...nextRun,
    activities: nextAgentActivities(nextRun.activities ?? [], activities),
  }
}

function nextAgentActivities(
  activities: QuickChatAgentRun["activities"],
  updates: UserStoryAgentActivity[]
) {
  const currentActivities = activities ?? []
  return updates.reduce(upsertAgentActivity, currentActivities)
}

function activityUpdateList(
  activity: QuickChatAgentRunUpdate["agentActivity"]
) {
  return activity ? [activity] : []
}

function upsertAgentActivity(
  activities: UserStoryAgentActivity[],
  activity: UserStoryAgentActivity
) {
  const exists = activities.some((item) => item.id === activity.id)
  if (!exists) return [...activities, activity]
  return activities.map((item) => (item.id === activity.id ? activity : item))
}

function quickChatWithLocallyUpdatedAgentRun(
  currentChat: QuickChat,
  targetChat: QuickChat,
  run: QuickChatAgentRun,
  input: QuickChatAgentRunUpdate,
  result: { onNextRun(run: QuickChatAgentRun): void }
) {
  if (currentChat.id !== targetChat.id) return currentChat
  const currentRun =
    currentChat.agentRuns?.find((currentRun) => currentRun.id === run.id) ?? run
  const nextRun = agentRunWithUpdate(currentRun, input)
  result.onNextRun(nextRun)
  return mergeQuickChatAgentRun(currentChat, nextRun)
}

function definedUpdate(input: QuickChatUpdate | QuickChatAgentRunUpdate) {
  const { agentActivity, agentActivityUpdates, ...update } = input
  void agentActivity
  void agentActivityUpdates
  return Object.fromEntries(
    Object.entries(update).filter(([, value]) => value !== undefined)
  )
}

function loadingState(
  current: QuickChatState,
  projectId: string
): QuickChatState {
  if (current.projectId === projectId) {
    return {
      ...current,
      detailedChatIds: current.detailedChatIds ?? new Set(),
      error: undefined,
      loading: true,
    }
  }
  return {
    chats: [],
    detailedChatIds: new Set(),
    loading: true,
    projectId,
  }
}

function chatStateIds(
  current: Set<number> | undefined,
  chatId: number,
  enabled: boolean
) {
  const next = new Set(current)
  if (enabled) next.add(chatId)
  else next.delete(chatId)
  return next
}
