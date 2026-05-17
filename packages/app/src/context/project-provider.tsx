import * as React from "react"

import { useCloudAuth } from "@/context/cloud-auth"
import { usePlatform } from "@/context/platform"
import { ProjectContext } from "@/context/projects"
import { useServer } from "@/context/server"
import { createCloudApi } from "@/lib/cloud-api"
import { createSdkForServer } from "@/lib/opencode-client"
import { createProject, type Project } from "@/lib/projects"

const storageKey = "opencode.app.projects.v1"
const recentLimit = 10

type ProjectState = {
  active?: string
  recent: Project[]
}

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const auth = useCloudAuth()
  const platform = usePlatform()
  const server = useServer()
  const value = useProjectState(auth, platform, server.server)

  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  )
}

function useProjectState(
  auth: ReturnType<typeof useCloudAuth>,
  platform: ReturnType<typeof usePlatform>,
  server: ReturnType<typeof useServer>["server"]
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
        const project = await resolveProject(path, auth, server)
        setState((current) => openProjectState(current, project))
      } finally {
        setOpening(false)
      }
    },
    [auth, server]
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
  server: ReturnType<typeof useServer>["server"]
) {
  const backend = await resolveBackendProject(path, server)
  const localProject = createProject(path, backend)
  const cloudProject = await createCloudApi(auth.apiConnection).ensureProject({
    name: localProject.name,
    repositoryFingerprint: backend?.id === "global" ? null : backend?.id ?? null,
  })

  return createProject(path, backend, cloudProject)
}

async function resolveBackendProject(
  path: string,
  server: ReturnType<typeof useServer>["server"]
) {
  if (!server) return undefined
  try {
    const result = await createSdkForServer(server).project.current({
      directory: path,
    })
    return result.data
  } catch {
    return undefined
  }
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
