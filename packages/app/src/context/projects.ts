import * as React from "react"

import type { Project } from "@/lib/projects"

export type ProjectContextValue = {
  activeProject?: Project
  recentProjects: Project[]
  opening: boolean
  openProject(path: string): Promise<void>
  chooseProject(): Promise<void>
  removeRecentProject(path: string): void
}

export const ProjectContext = React.createContext<
  ProjectContextValue | undefined
>(undefined)

export function useProjects() {
  const context = React.useContext(ProjectContext)
  if (!context)
    throw new Error("useProjects must be used within ProjectProvider")
  return context
}
