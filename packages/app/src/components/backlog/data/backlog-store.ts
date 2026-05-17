import * as React from "react"

import { createBacklogApi } from "@/components/backlog/data/backlog-api"
import type {
  BacklogColumnId,
  UserStory,
  UserStoryDraft,
  UserStoryUpdate,
} from "@/components/backlog/data/backlog-data"
import { useCloudAuth } from "@/context/cloud-auth"
import { useProjects } from "@/context/projects"

type BacklogState = {
  error?: string
  loading: boolean
  stories: UserStory[]
}

export function useBacklogStore() {
  const auth = useCloudAuth()
  const projects = useProjects()
  const [state, setState] = React.useState<BacklogState>({
    loading: false,
    stories: [],
  })
  const projectId = projects.activeProject?.id
  const projectPath = projects.activeProject?.path

  const api = React.useMemo(
    () => createBacklogApi(auth.apiConnection),
    [auth.apiConnection]
  )

  const load = React.useCallback(async () => {
    if (!projectId) {
      setState({ loading: false, stories: [] })
      return
    }
    setState((current) => ({ ...current, error: undefined, loading: true }))
    try {
      setState({ loading: false, stories: await api.list(projectId) })
    } catch (error) {
      setState({
        error: error instanceof Error ? error.message : "Unable to load user stories.",
        loading: false,
        stories: [],
      })
    }
  }, [api, projectId])

  React.useEffect(() => {
    void load()
  }, [load])

  const create = React.useCallback(
    async (input: Omit<UserStoryDraft, "projectId">) => {
      if (!projectId) throw new Error("Open a project before creating a user story.")
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
      const nextStory = await api.update(story.id, input)
      setState((current) => ({
        ...current,
        stories: current.stories.map((currentStory) =>
          currentStory.id === story.id ? nextStory : currentStory
        ),
      }))
      return nextStory
    },
    [api]
  )

  const remove = React.useCallback(
    async (story: UserStory) => {
      await api.delete(story.id)
      setState((current) => ({
        ...current,
        stories: current.stories.filter((currentStory) => currentStory.id !== story.id),
      }))
    },
    [api]
  )

  const storiesForColumn = React.useCallback(
    (column: BacklogColumnId) =>
      state.stories.filter((story) => story.status === column),
    [state.stories]
  )

  return {
    ...state,
    create,
    load,
    projectId,
    projectPath,
    remove,
    storiesForColumn,
    update,
  }
}
