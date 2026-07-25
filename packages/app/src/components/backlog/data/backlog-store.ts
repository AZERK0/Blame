import * as React from "react"

import { createBacklogApi } from "@/components/backlog/data/backlog-api"
import {
  mergeLoadedStories,
  mergeStoryAgentRun,
  mergeUserStory,
} from "@/components/backlog/data/backlog-store-merge"
import type {
  BacklogColumnId,
  UserStory,
  UserStoryAgentActivity,
  UserStoryAgentRun,
  UserStoryAgentRunDraft,
  UserStoryAgentRunUpdate,
  UserStoryComment,
  UserStoryDraft,
  UserStoryUpdate,
} from "@/components/backlog/data/backlog-data"
import { useCloudAuth } from "@/context/cloud-auth"
import { useProjects } from "@/context/projects"
import { recordPerformanceCount } from "@/lib/performance-diagnostics"

type BacklogState = {
  cleanupStoryIds: Set<string>
  detailedStoryIds: Set<string>
  error?: string
  loading: boolean
  projectId?: string
  setupInitializingStoryIds: Set<string>
  stories: UserStory[]
}

type BacklogStoreValue = ReturnType<typeof useBacklogStoreValue>

const BacklogStoreContext = React.createContext<BacklogStoreValue | undefined>(
  undefined
)

export function BacklogStoreProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const value = useBacklogStoreValue()

  return React.createElement(BacklogStoreContext.Provider, { value }, children)
}

export function useBacklogStore() {
  const context = React.useContext(BacklogStoreContext)
  if (!context)
    throw new Error("useBacklogStore must be used within BacklogStoreProvider")
  return context
}

function useBacklogStoreValue() {
  const auth = useCloudAuth()
  const projects = useProjects()
  const [state, setState] = React.useState<BacklogState>({
    cleanupStoryIds: new Set(),
    detailedStoryIds: new Set(),
    loading: false,
    setupInitializingStoryIds: new Set(),
    stories: [],
  })
  const loadRequestId = React.useRef(0)
  const detailRequests = React.useRef(new Map<string, Promise<UserStory>>())
  const updateQueues = React.useRef(new Map<string, Promise<unknown>>())
  const projectId = projects.activeProject?.id
  const projectPath = projects.activeProject?.path

  const api = React.useMemo(
    () => createBacklogApi(auth.apiConnection),
    [auth.apiConnection]
  )

  const load = React.useCallback(async () => {
    const requestId = ++loadRequestId.current
    if (!projectId) {
      setState({
        cleanupStoryIds: new Set(),
        detailedStoryIds: new Set(),
        loading: false,
        projectId: undefined,
        setupInitializingStoryIds: new Set(),
        stories: [],
      })
      return
    }
    setState((current) => loadingState(current, projectId))
    try {
      const loadedStories = await api.list(projectId)
      if (loadRequestId.current !== requestId) return
      setState((current) => ({
        ...current,
        error: undefined,
        loading: false,
        projectId,
        stories: mergeLoadedStories(current.stories, loadedStories),
      }))
    } catch (error) {
      if (loadRequestId.current !== requestId) return
      setState({
        cleanupStoryIds: new Set(),
        error:
          error instanceof Error
            ? error.message
            : "Unable to load user stories.",
        loading: false,
        projectId,
        detailedStoryIds: new Set(),
        setupInitializingStoryIds: new Set(),
        stories: [],
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
    async (input: Omit<UserStoryDraft, "projectId">) => {
      if (!projectId)
        throw new Error("Open a project before creating a user story.")
      const story = await api.create({ ...input, projectId })
      setState((current) => ({
        ...current,
        detailedStoryIds: storyStateIds(
          current.detailedStoryIds,
          story.id,
          true
        ),
        stories: [...current.stories, story],
      }))
      return story
    },
    [api, projectId]
  )

  const update = React.useCallback(
    async (story: UserStory, input: UserStoryUpdate) => {
      const previousUpdate =
        updateQueues.current.get(story.id) ?? Promise.resolve()
      const nextUpdate = previousUpdate
        .catch(() => undefined)
        .then(async () => {
          const nextStory = await api.update(story.id, input)
          setState((current) => ({
            ...current,
            detailedStoryIds: storyStateIds(
              current.detailedStoryIds,
              nextStory.id,
              true
            ),
            stories: current.stories.map((currentStory) =>
              currentStory.id === story.id
                ? mergeUserStory(currentStory, nextStory, {
                    replaceAgentActivities: input.agentActivities !== undefined,
                  })
                : currentStory
            ),
          }))
          return nextStory
        })
      updateQueues.current.set(story.id, nextUpdate)
      try {
        return await nextUpdate
      } finally {
        if (updateQueues.current.get(story.id) === nextUpdate) {
          updateQueues.current.delete(story.id)
        }
      }
    },
    [api]
  )
  const undoComment = React.useCallback(
    async (
      story: UserStory,
      commentId: string,
      input: { clineSessionId?: string; runId: string }
    ) => {
      const nextStory = await api.undoComment(story.id, commentId, input)
      replaceStory(nextStory, setState)
      return nextStory
    },
    [api]
  )
  const validateCommentUndo = React.useCallback(
    (story: UserStory, commentId: string, runId: string) =>
      api.validateCommentUndo(story.id, commentId, runId),
    [api]
  )
  const createComment = React.useCallback(
    async (
      story: UserStory,
      input: Pick<UserStoryComment, "body" | "codeSelectionAttachments">
    ) => {
      const comment = await api.createComment(story.id, input)
      setState((current) => ({
        ...current,
        detailedStoryIds: storyStateIds(
          current.detailedStoryIds,
          story.id,
          true
        ),
        stories: current.stories.map((currentStory) =>
          currentStory.id === story.id
            ? storyWithComment(currentStory, comment)
            : currentStory
        ),
      }))
      return comment
    },
    [api]
  )
  const createAgentRun = React.useCallback(
    async (story: UserStory, input: UserStoryAgentRunDraft) => {
      const run = await api.createAgentRun(story.id, input)
      setState((current) => ({
        ...current,
        detailedStoryIds: storyStateIds(
          current.detailedStoryIds,
          story.id,
          true
        ),
        stories: current.stories.map((currentStory) =>
          currentStory.id === story.id
            ? mergeStoryAgentRun(currentStory, run)
            : currentStory
        ),
      }))
      return run
    },
    [api]
  )
  const updateAgentRun = React.useCallback(
    async (
      story: UserStory,
      run: UserStoryAgentRun,
      input: UserStoryAgentRunUpdate
    ) => {
      const nextRun = await api.updateAgentRun(story.id, run.id, input)
      setState((current) => ({
        ...current,
        stories: current.stories.map((currentStory) =>
          currentStory.id === story.id
            ? mergeStoryAgentRun(currentStory, nextRun)
            : currentStory
        ),
      }))
      return nextRun
    },
    [api]
  )
  const updateAgentLocal = React.useCallback(
    (
      story: UserStory,
      input: UserStoryUpdate,
      run?: UserStoryAgentRun,
      runInput?: UserStoryAgentRunUpdate
    ) => {
      recordPerformanceCount("backlog.store.update_agent_local")
      React.startTransition(() => {
        setState((current) => ({
          ...current,
          stories: current.stories.map((currentStory) =>
            storyWithLocalAgentUpdate(currentStory, story, input, run, runInput)
          ),
        }))
      })
    },
    []
  )
  const activityDetail = React.useCallback(
    (story: UserStory, activityId: string) =>
      api.activityDetail(story.id, activityId),
    [api]
  )
  const loadDetail = React.useCallback(
    async (story: Pick<UserStory, "id">) => {
      const existingRequest = detailRequests.current.get(story.id)
      if (existingRequest) return existingRequest
      const request = api
        .get(story.id)
        .then((loadedStory) => {
          setState((current) => ({
            ...current,
            detailedStoryIds: storyStateIds(
              current.detailedStoryIds,
              loadedStory.id,
              true
            ),
            stories: current.stories.map((currentStory) =>
              currentStory.id === loadedStory.id
                ? mergeUserStory(currentStory, loadedStory)
                : currentStory
            ),
          }))
          return loadedStory
        })
        .finally(() => {
          detailRequests.current.delete(story.id)
        })
      detailRequests.current.set(story.id, request)
      return request
    },
    [api]
  )
  const updateLocal = React.useCallback(
    (story: UserStory, input: UserStoryUpdate) => {
      recordPerformanceCount("backlog.store.update_local")
      setState((current) => ({
        ...current,
        stories: current.stories.map((currentStory) =>
          currentStory.id === story.id
            ? { ...currentStory, ...definedUpdate(input) }
            : currentStory
        ),
      }))
    },
    []
  )

  const remove = React.useCallback(
    async (story: UserStory) => {
      await api.delete(story.id)
      setState((current) => ({
        ...current,
        detailedStoryIds: storyStateIds(
          current.detailedStoryIds,
          story.id,
          false
        ),
        stories: current.stories.filter(
          (currentStory) => currentStory.id !== story.id
        ),
      }))
    },
    [api]
  )

  const storiesForColumn = React.useCallback(
    (column: BacklogColumnId) =>
      state.stories.filter((story) => story.status === column),
    [state.stories]
  )
  const setStorySetupInitializing = React.useCallback(
    (story: UserStory, initializing: boolean) => {
      setState((current) => ({
        ...current,
        setupInitializingStoryIds: setupInitializingStoryIds(
          current.setupInitializingStoryIds,
          story.id,
          initializing
        ),
      }))
    },
    []
  )
  const storySetupInitializing = React.useCallback(
    (story?: UserStory) =>
      Boolean(story && state.setupInitializingStoryIds.has(story.id)),
    [state.setupInitializingStoryIds]
  )
  const setStoryCleanup = React.useCallback(
    (story: UserStory, cleanup: boolean) => {
      setState((current) => ({
        ...current,
        cleanupStoryIds: storyStateIds(
          current.cleanupStoryIds,
          story.id,
          cleanup
        ),
      }))
    },
    []
  )
  const storyCleanup = React.useCallback(
    (story?: UserStory) =>
      Boolean(story && state.cleanupStoryIds.has(story.id)),
    [state.cleanupStoryIds]
  )

  return {
    ...state,
    create,
    createAgentRun,
    createComment,
    activityDetail,
    loadDetail,
    load,
    projectId,
    projectPath,
    remove,
    setStoryCleanup,
    setStorySetupInitializing,
    storyCleanup,
    storyDetailsLoaded: (story?: Pick<UserStory, "id">) =>
      Boolean(story && state.detailedStoryIds?.has(story.id)),
    storySetupInitializing,
    storiesForColumn,
    undoComment,
    validateCommentUndo,
    update,
    updateAgentLocal,
    updateAgentRun,
    updateLocal,
  }
}

function agentRunWithUpdate(
  run: UserStoryAgentRun,
  input: UserStoryAgentRunUpdate
) {
  const { agentActivity, agentActivityUpdates, ...metadata } = input
  const nextRun = {
    ...run,
    ...definedUpdate(metadata),
    updatedAt: new Date().toISOString(),
  }
  const activities = agentActivityUpdates ?? activityUpdateList(agentActivity)
  if (!activities.length) return nextRun
  return {
    ...nextRun,
    activities: nextAgentActivities(nextRun.activities ?? [], activities),
  }
}

function nextAgentActivities(
  activities: UserStoryAgentRun["activities"],
  updates: UserStoryAgentActivity[]
) {
  const currentActivities = activities ?? []
  return updates.reduce(upsertAgentActivity, currentActivities)
}

function activityUpdateList(
  activity: UserStoryAgentRunUpdate["agentActivity"]
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

function storyWithComment(story: UserStory, comment: UserStoryComment) {
  return {
    ...story,
    comments: [...(story.comments ?? []), comment],
  }
}

function storyWithLocalAgentUpdate(
  currentStory: UserStory,
  targetStory: UserStory,
  input: UserStoryUpdate,
  run?: UserStoryAgentRun,
  runInput?: UserStoryAgentRunUpdate
) {
  if (currentStory.id !== targetStory.id) return currentStory
  const nextStory = { ...currentStory, ...definedUpdate(input) }
  if (!run || !runInput) return nextStory
  const currentRun =
    nextStory.agentRuns?.find((currentRun) => currentRun.id === run.id) ?? run
  return mergeStoryAgentRun(nextStory, agentRunWithUpdate(currentRun, runInput))
}

function definedUpdate(input: UserStoryUpdate | UserStoryAgentRunUpdate) {
  const { agentActivity, ...update } = input
  void agentActivity
  return Object.fromEntries(
    Object.entries(update).filter(([, value]) => value !== undefined)
  )
}

function setupInitializingStoryIds(
  current: Set<string>,
  storyId: string,
  initializing: boolean
) {
  return storyStateIds(current, storyId, initializing)
}

function storyStateIds(
  current: Set<string> | undefined,
  storyId: string,
  active: boolean
) {
  const next = new Set(current)
  if (active) next.add(storyId)
  else next.delete(storyId)
  return next
}

function replaceStory(
  story: UserStory,
  setState: React.Dispatch<React.SetStateAction<BacklogState>>
) {
  setState((current) => ({
    ...current,
    detailedStoryIds: storyStateIds(current.detailedStoryIds, story.id, true),
    stories: current.stories.map((currentStory) =>
      currentStory.id === story.id ? story : currentStory
    ),
  }))
}

function loadingState(current: BacklogState, projectId: string): BacklogState {
  if (current.projectId === projectId) {
    return {
      ...current,
      detailedStoryIds: current.detailedStoryIds ?? new Set(),
      error: undefined,
      loading: true,
    }
  }
  return {
    cleanupStoryIds: new Set(),
    detailedStoryIds: new Set(),
    loading: true,
    projectId,
    setupInitializingStoryIds: new Set(),
    stories: [],
  }
}
