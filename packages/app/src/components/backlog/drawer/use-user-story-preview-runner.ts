import type { ProjectPreviewRuntimeState } from "@blame/agent-runtime"
import * as React from "react"
import { toast } from "sonner"

import type { ProjectRunnerPendingOperation } from "@/components/backlog/board/project-runner-types"
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
  const [selection, setSelection] = React.useState<{
    configurationId: string
    worktree?: string | null
  }>()
  const select = React.useCallback(
    (configurationId: string) => setSelection({ configurationId, worktree }),
    [worktree]
  )
  usePreviewRuntimePolling(workspace, worktree, enabled, setRuntime)
  const { control, pendingOperation } = usePreviewRuntimeControl(
    workspace,
    worktree,
    setRuntime,
    select
  )
  const selectedOverride =
    selection && selection.worktree === worktree
      ? selection.configurationId
      : undefined
  const selectedId = selectedConfigurationId(runtime, selectedOverride)
  return {
    control,
    pendingOperation,
    runtime,
    selectedId,
    select,
  }
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
  setRuntime: PreviewRuntimeSetter,
  setSelectedId: (configurationId: string) => void
) {
  const [pendingOperation, setPendingOperation] =
    React.useState<ProjectRunnerPendingOperation>()
  const control = React.useCallback(
    async (action: PreviewRunnerAction, configurationId?: string) => {
      if (!worktree || !workspace?.controlProjectPreview || pendingOperation)
        return undefined
      const selectedId = configurationId
      if (!selectedId) return undefined
      setSelectedId(selectedId)
      setPendingOperation({ action, configurationId: selectedId })
      const next = await requestPreviewRuntime(
        workspace,
        worktree,
        action,
        selectedId
      )
      if (next) setRuntime(next)
      setPendingOperation(undefined)
      return next
    },
    [pendingOperation, setRuntime, setSelectedId, workspace, worktree]
  )
  return { control, pendingOperation }
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

function selectedConfigurationId(
  runtime: ProjectPreviewRuntimeState | undefined,
  selectedOverride: string | undefined
) {
  const overrideExists = runtime?.configurations.some(
    ({ id }) => id === selectedOverride
  )
  return overrideExists ? selectedOverride : runtime?.selectedConfigurationId
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
