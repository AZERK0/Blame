import * as React from "react"

import type {
  CloudProjectInitialization,
  CloudProjectInitializationStatus,
} from "@/context/cloud-auth"
import { useCloudAuth } from "@/context/cloud-auth"
import { useProjects } from "@/context/projects"
import { createCloudApi } from "@/lib/cloud-api"

export function useProjectInitialization() {
  const auth = useCloudAuth()
  const projects = useProjects()
  const [snapshot, setSnapshot] =
    React.useState<ProjectInitializationStatusSnapshot>()
  const activeProjectId = projects.activeProject?.id
  const currentSnapshot =
    auth.status === "authenticated" && snapshot?.projectId === activeProjectId
      ? snapshot
      : undefined

  React.useEffect(() => {
    const activeProject = projects.activeProject
    if (!activeProject || auth.status !== "authenticated") return
    let cancelled = false
    let timer: number | undefined
    const cloud = createCloudApi(auth.apiConnection)
    const refresh = async () => {
      const snapshot = await cloud.projectInitialization(activeProject.id)
      if (cancelled) return
      const status = snapshot.initialization?.status ?? "pending"
      setSnapshot({
        initialization: snapshot.initialization ?? undefined,
        projectId: activeProject.id,
        status,
      })
      if (projectInitializing(status)) {
        timer = window.setTimeout(() => void refresh().catch(() => undefined), 5_000)
      }
    }
    void refresh().catch(() => {
      if (!cancelled) setSnapshot(undefined)
    })
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [auth, projects.activeProject])

  return currentSnapshot
}

export function projectInitializing(
  status: CloudProjectInitializationStatus | null
) {
  return status === "pending" || status === "running"
}

type ProjectInitializationStatusSnapshot = {
  initialization?: CloudProjectInitialization
  projectId: string
  status: CloudProjectInitializationStatus
}
