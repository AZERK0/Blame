import * as React from "react"

import { useCloudAuth, type CloudProject } from "@/context/cloud-auth"
import { usePlatform } from "@/context/platform"
import {
  ProjectContext,
  type GeneratedProjectInitialization,
} from "@/context/projects"
import { createCloudApi } from "@/lib/cloud-api"
import { notifyProjectInitializationUpdated } from "@/components/project-initialization/project-initialization-events"
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
  const authStatus = auth.status
  const apiConnection = auth.apiConnection
  const workspace = platform.workspace

  React.useEffect(() => {
    writeProjectState(state)
  }, [state])

  React.useEffect(() => {
    if (authStatus !== "unauthenticated") return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setState((current) =>
        sameProjectState(current, emptyProjectState())
          ? current
          : emptyProjectState()
      )
    })
    return () => {
      cancelled = true
    }
  }, [authStatus])

  React.useEffect(() => {
    let cancelled = false
    void removeUnavailableProjects(
      state,
      authStatus,
      apiConnection,
      workspace
    ).then((next) => {
      if (cancelled || sameProjectState(state, next)) return
      setState((current) => (sameProjectState(current, state) ? next : current))
    })
    return () => {
      cancelled = true
    }
  }, [apiConnection, authStatus, state, workspace])

  const openProject = React.useCallback(
    async (path: string) => {
      setOpening(true)
      try {
        const project = await resolveProject(path, auth, platform)
        setState((current) => openProjectState(current, project))
        return project
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
      clineSessionId: initialization.clineSessionId,
      previewManifest: initialization.previewManifest,
      setupScript: initialization.setupScript,
      dockerCompose: initialization.dockerCompose,
      runConfigurations: initialization.runConfigurations,
      practices: initialization.practices ?? generatedProjectPractices(),
    }
  )
  notifyProjectInitializationUpdated(projectId)
}

function generatedProjectPractices() {
  return [
    practice(
      "coding_style",
      "Blame generated this project with the standard coding style baseline."
    ),
    practice(
      "unit_tests",
      "Blame generated this project with the standard testing baseline."
    ),
    practice(
      "layered_architecture",
      "Blame generated this project with the standard project architecture baseline."
    ),
    practice(
      "commit_message_convention",
      "Blame generated this project with the standard commit convention baseline."
    ),
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

function emptyProjectState(): ProjectState {
  return { recent: [] }
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

async function removeUnavailableProjects(
  state: ProjectState,
  authStatus: ReturnType<typeof useCloudAuth>["status"],
  apiConnection: ReturnType<typeof useCloudAuth>["apiConnection"],
  workspace: ReturnType<typeof usePlatform>["workspace"]
) {
  const cloudProjects = await availableCloudProjects(authStatus, apiConnection)
  const recent = await availableLocalProjects(state.recent, workspace)
  const available = cloudProjects
    ? recent.filter((project) => projectExistsInCloud(project, cloudProjects))
    : recent

  return normalizeProjectState({ active: state.active, recent: available })
}

async function availableCloudProjects(
  authStatus: ReturnType<typeof useCloudAuth>["status"],
  apiConnection: ReturnType<typeof useCloudAuth>["apiConnection"]
) {
  if (authStatus !== "authenticated") return
  try {
    return await createCloudApi(apiConnection).projects()
  } catch {
    return
  }
}

function projectExistsInCloud(project: Project, cloudProjects: CloudProject[]) {
  return cloudProjects.some((cloudProject) => {
    if (cloudProject.id === project.id) return true
    if (
      project.repositoryFingerprint &&
      cloudProject.repositoryFingerprint === project.repositoryFingerprint
    ) {
      return true
    }
    return cloudProject.name === project.name
  })
}

async function availableLocalProjects(
  projects: Project[],
  workspace: ReturnType<typeof usePlatform>["workspace"]
) {
  const availability = await Promise.all(
    projects.map(async (project) => ({
      project,
      available: await projectPathExists(project, workspace),
    }))
  )
  return availability
    .filter((item) => item.available)
    .map((item) => item.project)
}

async function projectPathExists(
  project: Project,
  workspace: ReturnType<typeof usePlatform>["workspace"]
) {
  return (await workspace?.pathExists({ path: project.path })) ?? true
}

function sameProjectState(left: ProjectState, right: ProjectState) {
  if (left.active !== right.active) return false
  if (left.recent.length !== right.recent.length) return false
  return left.recent.every((project, index) => project === right.recent[index])
}

function uniqueProjectsByPath(projects: Project[]) {
  return projects.filter(
    (project, index) =>
      projects.findIndex((item) => item.path === project.path) === index
  )
}

function writeProjectState(state: ProjectState) {
  if (sameProjectState(state, emptyProjectState())) {
    localStorage.removeItem(storageKey)
    return
  }
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
