import type { ProjectPreviewRuntimeState } from "@blame/agent-runtime"
import * as React from "react"
import { toast } from "sonner"

import { usePlatform } from "@/context/platform"

export type PreviewRunnerAction = "start" | "stop" | "restart"
type PreviewRuntimeSetter = React.Dispatch<
  React.SetStateAction<ProjectPreviewRuntimeState | undefined>
>

export function useUserStoryPreviewRunner(
  worktree: string | null | undefined,
  enabled: boolean
) {
  const workspace = usePlatform().workspace
  const [runtime, setRuntime] = React.useState<ProjectPreviewRuntimeState>()
  usePreviewRuntimePolling(workspace, worktree, enabled, setRuntime)
  const { control, pending } = usePreviewRuntimeControl(
    workspace,
    worktree,
    setRuntime
  )
  return { control, pending, runtime }
}

function usePreviewRuntimePolling(
  workspace: ReturnType<typeof usePlatform>["workspace"],
  worktree: string | null | undefined,
  enabled: boolean,
  setRuntime: PreviewRuntimeSetter
) {
  React.useEffect(() => {
    setRuntime(undefined)
    if (!worktree || !workspace?.projectPreviewRuntimeState) return
    let cancelled = false
    const refresh = () => {
      void refreshPreviewRuntime(
        workspace,
        worktree,
        () => cancelled,
        setRuntime
      )
    }
    if (enabled) refresh()
    const interval = enabled ? window.setInterval(refresh, 2_000) : undefined
    return () => {
      cancelled = true
      if (interval) window.clearInterval(interval)
    }
  }, [enabled, setRuntime, workspace, worktree])
}

async function refreshPreviewRuntime(
  workspace: ReturnType<typeof usePlatform>["workspace"],
  worktree: string,
  cancelled: () => boolean,
  setRuntime: PreviewRuntimeSetter
) {
  try {
    const next = await workspace?.projectPreviewRuntimeState?.({ worktree })
    if (!cancelled() && next?.configurations.length) setRuntime(next)
  } catch {
    return
  }
}

function usePreviewRuntimeControl(
  workspace: ReturnType<typeof usePlatform>["workspace"],
  worktree: string | null | undefined,
  setRuntime: PreviewRuntimeSetter
) {
  const [pending, setPending] = React.useState(false)
  const control = React.useCallback(
    async (action: PreviewRunnerAction, configurationId?: string) => {
      if (!worktree || !workspace?.controlProjectPreview) return undefined
      setPending(true)
      const next = await requestPreviewRuntime(
        workspace,
        worktree,
        action,
        configurationId
      )
      if (next) setRuntime(next)
      setPending(false)
      return next
    },
    [setRuntime, workspace, worktree]
  )
  return { control, pending }
}

async function requestPreviewRuntime(
  workspace: NonNullable<ReturnType<typeof usePlatform>["workspace"]>,
  worktree: string,
  action: PreviewRunnerAction,
  configurationId: string | undefined
) {
  try {
    return await workspace.controlProjectPreview!({
      action,
      configurationId,
      worktree,
    })
  } catch (error) {
    toast.error("Unable to control preview", {
      description: errorText(error),
      position: "bottom-right",
    })
    return undefined
  }
}

export type UserStoryPreviewRunner = ReturnType<
  typeof useUserStoryPreviewRunner
>

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
