import * as React from "react"

import { useCloudAuth } from "@/context/cloud-auth"
import { usePlatform } from "@/context/platform"
import {
  ProjectContext,
  type GeneratedProjectInitialization,
} from "@/context/projects"
import { createCloudApi } from "@/lib/cloud-api"
import { createProject, type Project } from "@/lib/projects"

const storageKey = "blame.app.projects.v1"
const recentLimit = 10

type ProjectState = {
  active?: string
  recent: Project[]
}

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const auth = useCloudAuth()
  const platform = usePlatform()
  const value = useProjectState(auth, platform)

  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  )
}

function useProjectState(
  auth: ReturnType<typeof useCloudAuth>,
  platform: ReturnType<typeof usePlatform>
) {
  const [state, setState] = React.useState(readProjectState)
  const [opening, setOpening] = React.useState(false)
  const activeProject = state.recent.find(
    (project) => project.id === state.active
  )

  React.useEffect(() => {
    writeProjectState(state)
  }, [state])

  const openProject = React.useCallback(
    async (path: string) => {
      setOpening(true)
      try {
        const project = await resolveProject(path, auth, platform)
        setState((current) => openProjectState(current, project))
      } finally {
        setOpening(false)
      }
    },
    [auth, platform]
  )

  const openGeneratedProject = React.useCallback(
    async (path: string, initialization: GeneratedProjectInitialization) => {
      setOpening(true)
      try {
        const project = await resolveProject(path, auth, platform)
        await completeGeneratedProjectInitialization(
          auth,
          project.id,
          initialization
        )
        setState((current) => openProjectState(current, project))
      } finally {
        setOpening(false)
      }
    },
    [auth, platform]
  )

  const chooseProject = React.useCallback(async () => {
    const result = await platform.openDirectoryPickerDialog?.({
      title: "Open Project",
    })
    const path = Array.isArray(result) ? result[0] : result
    if (path) await openProject(path)
  }, [openProject, platform])

  const removeRecentProject = React.useCallback((path: string) => {
    setState((current) => removeRecentProjectState(current, path))
  }, [])

  return React.useMemo(
    () => ({
      activeProject,
      recentProjects: state.recent.filter(
        (project) => project.id !== activeProject?.id
      ),
      opening,
      openProject,
      openGeneratedProject,
      chooseProject,
      removeRecentProject,
    }),
    [
      activeProject,
      chooseProject,
      openGeneratedProject,
      openProject,
      opening,
      removeRecentProject,
      state.recent,
    ]
  )
}

async function completeGeneratedProjectInitialization(
  auth: ReturnType<typeof useCloudAuth>,
  projectId: string,
  initialization: GeneratedProjectInitialization
) {
  if (auth.status !== "authenticated") return
  await createCloudApi(auth.apiConnection).completeProjectInitialization(
    projectId,
    {
      setupScript: initialization.setupScript,
      dockerCompose: initialization.dockerCompose,
      practices: generatedProjectPractices(),
    }
  )
}

function generatedProjectPractices() {
  return [
    practice("coding_style", "Blame generated this project with the standard coding style baseline."),
    practice("unit_tests", "Blame generated this project with the standard testing baseline."),
    practice("layered_architecture", "Blame generated this project with the standard project architecture baseline."),
    practice("commit_message_convention", "Blame generated this project with the standard commit convention baseline."),
  ]
}

function practice(practice: string, comment: string) {
  return { practice, detected: true, comment }
}

async function resolveProject(
  path: string,
  auth: ReturnType<typeof useCloudAuth>,
  platform: ReturnType<typeof usePlatform>
) {
  const localProject = createProject(path)
  await platform.workspace?.ensureGitRepository({ root: path })
  const repositoryFingerprint =
    (await platform.workspace?.gitRepositoryFingerprint({ root: path })) ?? null
  const cloudProject = await createCloudApi(auth.apiConnection).ensureProject({
    name: localProject.name,
    repositoryFingerprint,
  })

  return createProject(path, undefined, cloudProject)
}

function openProjectState(
  current: ProjectState,
  project: Project
): ProjectState {
  return {
    active: project.id,
    recent: [
      project,
      ...current.recent.filter((item) => item.path !== project.path),
    ].slice(0, recentLimit),
  }
}

function removeRecentProjectState(
  current: ProjectState,
  path: string
): ProjectState {
  const removedActiveProject = current.recent.some(
    (project) => project.id === current.active && project.path === path
  )

  return {
    active: removedActiveProject ? undefined : current.active,
    recent: current.recent.filter((project) => project.path !== path),
  }
}

function readProjectState(): ProjectState {
  const fallback = { recent: [] }

  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "")
    if (!isProjectState(parsed)) return fallback
    return normalizeProjectState(parsed)
  } catch {
    return fallback
  }
}

function normalizeProjectState(state: ProjectState): ProjectState {
  const activeProject = state.recent.find(
    (project) => project.id === state.active
  )
  const recent = activeProject
    ? uniqueProjectsByPath([
        activeProject,
        ...state.recent.filter((project) => project.id !== activeProject.id),
      ])
    : uniqueProjectsByPath(state.recent)

  return {
    active: recent.some((project) => project.id === state.active)
      ? state.active
      : undefined,
    recent,
  }
}

function uniqueProjectsByPath(projects: Project[]) {
  return projects.filter(
    (project, index) =>
      projects.findIndex((item) => item.path === project.path) === index
  )
}

function writeProjectState(state: ProjectState) {
  localStorage.setItem(storageKey, JSON.stringify(state))
}

function isProjectState(value: unknown): value is ProjectState {
  if (!value || typeof value !== "object") return false
  if (!("recent" in value) || !Array.isArray(value.recent)) return false
  return value.recent.every(isProject)
}

function isProject(value: unknown): value is Project {
  if (!value || typeof value !== "object") return false
  if (!("id" in value) || typeof value.id !== "string") return false
  if (!("path" in value) || typeof value.path !== "string") return false
  if (!("name" in value) || typeof value.name !== "string") return false
  if (!("initials" in value) || typeof value.initials !== "string") return false
  return "color" in value && typeof value.color === "string"
}
