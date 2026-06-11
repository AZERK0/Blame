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
  UserStoryAgentRun,
  UserStoryAgentRunDraft,
  UserStoryAgentRunUpdate,
  UserStoryComment,
  UserStoryDraft,
  UserStoryUpdate,
} from "@/components/backlog/data/backlog-data"
import { useCloudAuth } from "@/context/cloud-auth"
import { useProjects } from "@/context/projects"

type BacklogState = {
  cleanupStoryIds: Set<number>
  error?: string
  loading: boolean
  projectId?: string
  setupInitializingStoryIds: Set<number>
  stories: UserStory[]
}

export function useBacklogStore() {
  const auth = useCloudAuth()
  const projects = useProjects()
  const [state, setState] = React.useState<BacklogState>({
    cleanupStoryIds: new Set(),
    loading: false,
    setupInitializingStoryIds: new Set(),
    stories: [],
  })
  const loadRequestId = React.useRef(0)
  const updateQueues = React.useRef(new Map<number, Promise<unknown>>())
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
            stories: current.stories.map((currentStory) =>
              currentStory.id === story.id
                ? mergeUserStory(currentStory, nextStory)
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
  const createComment = React.useCallback(
    async (
      story: UserStory,
      input: Pick<UserStoryComment, "body" | "codeSelectionAttachments">
    ) => {
      const comment = await api.createComment(story.id, input)
      setState((current) => ({
        ...current,
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
  const updateAgentRunLocal = React.useCallback(
    (
      story: UserStory,
      run: UserStoryAgentRun,
      input: UserStoryAgentRunUpdate
    ) => {
      let nextRun = agentRunWithUpdate(run, input)
      setState((current) => ({
        ...current,
        stories: current.stories.map((currentStory) =>
          storyWithLocallyUpdatedAgentRun(currentStory, story, run, input, {
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
  const activityDetail = React.useCallback(
    (story: UserStory, activityId: string) =>
      api.activityDetail(story.id, activityId),
    [api]
  )
  const updateLocal = React.useCallback(
    (story: UserStory, input: UserStoryUpdate) => {
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
    load,
    projectId,
    projectPath,
    remove,
    setStoryCleanup,
    setStorySetupInitializing,
    storyCleanup,
    storySetupInitializing,
    storiesForColumn,
    update,
    updateAgentRun,
    updateAgentRunLocal,
    updateLocal,
  }
}

function agentRunWithUpdate(
  run: UserStoryAgentRun,
  input: UserStoryAgentRunUpdate
) {
  const { agentActivity, ...metadata } = input
  const nextRun = { ...run, ...definedUpdate(metadata) }
  if (!agentActivity) return nextRun
  return {
    ...nextRun,
    activities: nextAgentActivities(nextRun.activities ?? [], agentActivity),
  }
}

function nextAgentActivities(
  activities: UserStoryAgentRun["activities"],
  activity: NonNullable<UserStoryAgentRunUpdate["agentActivity"]>
) {
  const currentActivities = activities ?? []
  const exists = currentActivities.some((item) => item.id === activity.id)
  if (!exists) return [...currentActivities, activity]
  return currentActivities.map((item) =>
    item.id === activity.id ? activity : item
  )
}

function storyWithComment(story: UserStory, comment: UserStoryComment) {
  return {
    ...story,
    comments: [...(story.comments ?? []), comment],
  }
}

function storyWithLocallyUpdatedAgentRun(
  currentStory: UserStory,
  targetStory: UserStory,
  run: UserStoryAgentRun,
  input: UserStoryAgentRunUpdate,
  result: { onNextRun(run: UserStoryAgentRun): void }
) {
  if (currentStory.id !== targetStory.id) return currentStory
  const currentRun =
    currentStory.agentRuns?.find((currentRun) => currentRun.id === run.id) ??
    run
  const nextRun = agentRunWithUpdate(currentRun, input)
  result.onNextRun(nextRun)
  return mergeStoryAgentRun(currentStory, nextRun)
}

function definedUpdate(input: UserStoryUpdate | UserStoryAgentRunUpdate) {
  const { agentActivity, ...update } = input
  void agentActivity
  return Object.fromEntries(
    Object.entries(update).filter(([, value]) => value !== undefined)
  )
}

function setupInitializingStoryIds(
  current: Set<number>,
  storyId: number,
  initializing: boolean
) {
  return storyStateIds(current, storyId, initializing)
}

function storyStateIds(current: Set<number>, storyId: number, active: boolean) {
  const next = new Set(current)
  if (active) next.add(storyId)
  else next.delete(storyId)
  return next
}

function loadingState(current: BacklogState, projectId: string): BacklogState {
  if (current.projectId === projectId) {
    return { ...current, error: undefined, loading: true }
  }
  return {
    cleanupStoryIds: new Set(),
    loading: true,
    projectId,
    setupInitializingStoryIds: new Set(),
    stories: [],
  }
}
