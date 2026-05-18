import * as React from "react"

import { useCloudAuth } from "@/context/cloud-auth"
import { usePlatform } from "@/context/platform"
import { ProjectContext } from "@/context/projects"
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

  const chooseProject = React.useCallback(async () => {
    const result = await platform.openDirectoryPickerDialog?.({
      title: "Open Project",
    })
    const path = Array.isArray(result) ? result[0] : result
    if (path) await openProject(path)
  }, [openProject, platform])

  return React.useMemo(
    () => ({
      activeProject,
      recentProjects: state.recent.filter(
        (project) => project.id !== activeProject?.id
      ),
      opening,
      openProject,
      chooseProject,
    }),
    [activeProject, chooseProject, openProject, opening, state.recent]
  )
}

async function resolveProject(
  path: string,
  auth: ReturnType<typeof useCloudAuth>,
  platform: ReturnType<typeof usePlatform>
) {
  const localProject = createProject(path)
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
      ...current.recent.filter((item) => item.id !== project.id),
    ].slice(0, recentLimit),
  }
}

function readProjectState(): ProjectState {
  const fallback = { recent: [] }

  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "")
    if (!isProjectState(parsed)) return fallback
    return parsed
  } catch {
    return fallback
  }
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
