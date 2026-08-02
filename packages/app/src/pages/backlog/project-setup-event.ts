import type { UserStory } from "@/components/backlog/data/backlog-data"
import type { ProjectSetupEvent } from "@/context/platform"
import type { RepairProjectInitializationResult } from "@blame/agent-runtime"

export function projectSetupEventText(event: ProjectSetupEvent) {
  if (event.type === "exit") return `Setup exited with code ${event.data}`
  return event.data.trim()
}

export function projectSetupError(event: ProjectSetupEvent) {
  return (
    event.type === "stderr" || (event.type === "exit" && event.data !== "0")
  )
}

export function projectSetupCompleted(event: ProjectSetupEvent) {
  return event.type === "exit" && event.data === "0"
}

export async function projectSetupPreviewUrl(
  event: ProjectSetupEvent,
  worktree: string,
  workspaceMode: UserStory["workspaceMode"],
  resolvePreviewUrl: (worktree: string) => Promise<string | null>
) {
  if (workspaceMode === "cloud-mirror" || event.type !== "exit")
    return undefined
  try {
    return (await resolvePreviewUrl(worktree)) ?? undefined
  } catch {
    return undefined
  }
}

export function repairArtifacts(
  result: RepairProjectInitializationResult
): result is RepairProjectInitializationResult & {
  setupScript: string
  dockerCompose: string
} {
  return (
    result.classification === "repairable_initialization" &&
    Boolean(result.setupScript) &&
    Boolean(result.dockerCompose)
  )
}
