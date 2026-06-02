import * as React from "react"

import { createBacklogApi } from "@/components/backlog/data/backlog-api"
import type {
  BacklogColumnId,
  UserStory,
  UserStoryComment,
  UserStoryDraft,
  UserStoryUpdate,
} from "@/components/backlog/data/backlog-data"
import { useCloudAuth } from "@/context/cloud-auth"
import { useProjects } from "@/context/projects"

type BacklogState = {
  error?: string
  loading: boolean
  setupInitializingStoryIds: Set<number>
  stories: UserStory[]
}

export function useBacklogStore() {
  const auth = useCloudAuth()
  const projects = useProjects()
  const [state, setState] = React.useState<BacklogState>({
    loading: false,
    setupInitializingStoryIds: new Set(),
    stories: [],
  })
  const updateQueues = React.useRef(new Map<number, Promise<unknown>>())
  const projectId = projects.activeProject?.id
  const projectPath = projects.activeProject?.path

  const api = React.useMemo(
    () => createBacklogApi(auth.apiConnection),
    [auth.apiConnection]
  )

  const load = React.useCallback(async () => {
    if (!projectId) {
      setState({
        loading: false,
        setupInitializingStoryIds: new Set(),
        stories: [],
      })
      return
    }
    setState((current) => ({ ...current, error: undefined, loading: true }))
    try {
      setState({
        loading: false,
        setupInitializingStoryIds: new Set(),
        stories: await api.list(projectId),
      })
    } catch (error) {
      setState({
        error:
          error instanceof Error
            ? error.message
            : "Unable to load user stories.",
        loading: false,
        setupInitializingStoryIds: new Set(),
        stories: [],
      })
    }
  }, [api, projectId])

  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
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
                ? newestUserStory(currentStory, nextStory)
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
    async (story: UserStory, input: { body: string }) => {
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

  return {
    ...state,
    create,
    createComment,
    activityDetail,
    load,
    projectId,
    projectPath,
    remove,
    setStorySetupInitializing,
    storySetupInitializing,
    storiesForColumn,
    update,
    updateLocal,
  }
}

function storyWithComment(story: UserStory, comment: UserStoryComment) {
  return {
    ...story,
    comments: [...(story.comments ?? []), comment],
  }
}

function definedUpdate(input: UserStoryUpdate) {
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
  const next = new Set(current)
  if (initializing) next.add(storyId)
  else next.delete(storyId)
  return next
}

function newestUserStory(currentStory: UserStory, nextStory: UserStory) {
  const currentUpdatedAt = timestamp(currentStory.updatedAt)
  const nextUpdatedAt = timestamp(nextStory.updatedAt)
  if (currentUpdatedAt === undefined || nextUpdatedAt === undefined)
    return nextStory
  return nextUpdatedAt >= currentUpdatedAt ? nextStory : currentStory
}

function timestamp(value: string | null | undefined) {
  if (!value) return undefined
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : date
}
