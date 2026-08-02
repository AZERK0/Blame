import type { ProjectPreviewRuntimeState } from "@blame/agent-runtime"
import type { PreviewSessionView } from "@blame/preview-runtime"
import * as React from "react"
import { toast } from "sonner"

import type { ProjectRunnerPendingOperation } from "@/components/backlog/board/project-runner-types"
import { usePlatform } from "@/context/platform"
import {
  recordRuntimeSessionState,
  useRuntimePreference,
} from "@/lib/runtime-preference"

export type PreviewRunnerAction = "start" | "stop" | "restart"
type PreviewRuntimeSetter = React.Dispatch<
  React.SetStateAction<ProjectPreviewRuntimeState | undefined>
>

export function useUserStoryPreviewRunner(
  worktree: string | null | undefined,
  enabled: boolean,
  userStoryId?: string
) {
  const platform = usePlatform()
  const workspace = platform.workspace
  const preference = useRuntimePreference()
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
  const cloud = useCloudPreviewRuntime({
    enabled,
    localRuntime: runtime,
    platform,
    preference,
    userStoryId,
    worktree,
  })
  const local = usePreviewRuntimeControl(
    preference.profile === "local-container" ? workspace : undefined,
    worktree,
    setRuntime,
    select
  )
  const { control, pendingOperation } =
    preference.profile === "local-container" ? local : cloud
  const effectiveRuntime =
    preference.profile === "local-container" ? runtime : cloud.runtime
  React.useEffect(() => {
    if (!userStoryId) return
    const effectiveProfile = cloud.session?.profile ?? preference.profile
    const stoppedAndSynced =
      effectiveProfile === "local-container"
        ? effectiveRuntime?.desiredStatus !== "running"
        : !cloud.session ||
          (["idle", "stopped"].includes(cloud.session.state.engine) &&
            cloud.session.state.sync === "clean")
    recordRuntimeSessionState(userStoryId, effectiveProfile, stoppedAndSynced)
  }, [
    cloud.session,
    effectiveRuntime?.desiredStatus,
    preference.profile,
    userStoryId,
  ])
  const selectedOverride =
    selection && selection.worktree === worktree
      ? selection.configurationId
      : undefined
  const selectedId = selectedConfigurationId(effectiveRuntime, selectedOverride)
  return {
    control,
    pendingOperation,
    runtime: effectiveRuntime,
    previewSessionId: cloud.session?.id,
    integratedPreviewRequired:
      cloud.session?.endpointMap?.integratedPreviewRequired ?? false,
    profile: cloud.session?.profile ?? preference.profile,
    usage: cloud.session?.usage,
    selectedId,
    select,
  }
}

function useCloudPreviewRuntime(input: {
  enabled: boolean
  localRuntime?: ProjectPreviewRuntimeState
  platform: ReturnType<typeof usePlatform>
  preference: ReturnType<typeof useRuntimePreference>
  userStoryId?: string
  worktree?: string | null
}) {
  const [session, setSession] = React.useState<PreviewSessionView>()
  const [pendingOperation, setPendingOperation] =
    React.useState<ProjectRunnerPendingOperation>()
  const recoveredDelta = React.useRef<string | undefined>(undefined)
  const client = input.platform.previewRuntime
  const profile = input.preference.profile
  const storageId = input.userStoryId
    ? cloudSessionStorageId(input.userStoryId)
    : undefined
  const sessionId = session?.id

  React.useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) setSession(undefined)
    })
    if (
      !input.enabled ||
      profile === "local-container" ||
      !client ||
      !storageId
    )
      return () => {
        cancelled = true
      }
    const sessionId = localStorage.getItem(storageId)
    if (!sessionId)
      return () => {
        cancelled = true
      }
    void client
      .get({ sessionId })
      .then((value) => {
        if (!cancelled) setSession(value)
      })
      .catch(() => localStorage.removeItem(storageId))
    return () => {
      cancelled = true
    }
  }, [client, input.enabled, profile, storageId])

  React.useEffect(() => {
    if (!sessionId || !client || !input.enabled) return
    return client.onEvent({ sessionId }, () => {
      void client
        .get({ sessionId })
        .then(setSession)
        .catch(() => undefined)
    })
  }, [client, input.enabled, sessionId])

  React.useEffect(() => {
    if (
      !session ||
      !client ||
      !input.enabled ||
      !input.worktree ||
      session.state.sync !== "pending_local_sync" ||
      !["idle", "stopped", "failed"].includes(session.state.engine) ||
      session.state.agent !== "idle" ||
      !session.pendingDeltaArtifactId
    )
      return
    const key = `${session.id}:${session.pendingDeltaArtifactId}`
    if (recoveredDelta.current === key) return
    recoveredDelta.current = key
    void client
      .syncOut({ sessionId: session.id, localPath: input.worktree })
      .then(({ session: recovered }) => setSession(recovered))
      .catch((error) =>
        toast.error("Managed preview changes need attention", {
          description: errorText(error),
          position: "bottom-right",
        })
      )
  }, [client, input.enabled, input.worktree, session])

  React.useEffect(() => {
    if (!sessionId || !client || !input.enabled) return
    const interval = window.setInterval(() => {
      void client
        .get({ sessionId })
        .then(setSession)
        .catch(() => undefined)
    }, 10_000)
    return () => window.clearInterval(interval)
  }, [client, input.enabled, sessionId])

  const control = React.useCallback(
    async (action: PreviewRunnerAction, configurationId?: string) => {
      if (
        !client ||
        !input.worktree ||
        !input.userStoryId ||
        !configurationId ||
        profile === "local-container" ||
        !input.preference.confirmedCloudUploadAt ||
        pendingOperation
      )
        return undefined
      setPendingOperation({ action, configurationId })
      try {
        let active = session
        let importedCurrentWorkspace = false
        if (!active) {
          const manifestText = await input.platform.workspace?.readFile({
            root: input.worktree,
            path: ".blame/initialization/preview-manifest.json",
          })
          if (!manifestText) throw new Error("Preview manifest is unavailable")
          const operationId = await pendingCloudCreateOperation(
            input.userStoryId,
            profile,
            manifestText
          )
          active = await client.create({
            userStoryId: input.userStoryId,
            profile,
            previewManifest: JSON.parse(manifestText),
            cloudUploadConsentAt: input.preference.confirmedCloudUploadAt,
            operationId,
          })
          localStorage.setItem(
            cloudSessionStorageId(input.userStoryId),
            active.id
          )
          localStorage.removeItem(cloudCreateOperationStorageId(input.userStoryId))
          setSession(active)
        }
        if (!active.sourceRevision) {
          active = (
            await client.syncIn({
              sessionId: active.id,
              localPath: input.worktree,
            })
          ).session
          importedCurrentWorkspace = true
        }
        if (action === "start" && active.state.sync === "pending_local_sync") {
          active = (
            await client.syncOut({
              sessionId: active.id,
              localPath: input.worktree,
            })
          ).session
        }
        if (action === "stop" || action === "restart") {
          active = await client.command({
            sessionId: active.id,
            command: { type: "stop-services" },
            operationId: crypto.randomUUID(),
          })
          active = (
            await client.syncOut({
              sessionId: active.id,
              localPath: input.worktree,
            })
          ).session
        }
        if (action === "start" || action === "restart") {
          if (
            !importedCurrentWorkspace &&
            ["idle", "stopped", "failed"].includes(active.state.engine)
          ) {
            active = (
              await client.syncIn({
                sessionId: active.id,
                localPath: input.worktree,
              })
            ).session
          }
          active = await client.command({
            sessionId: active.id,
            command: {
              type: "start-services",
              configurationId,
              serviceIds: input.localRuntime?.configurations.find(
                ({ id }) => id === configurationId
              )?.services,
            },
            operationId: crypto.randomUUID(),
          })
        }
        setSession(active)
        return cloudRuntimeState(active, input.localRuntime)
      } catch (error) {
        toast.error("Unable to control managed preview", {
          description: errorText(error),
          position: "bottom-right",
        })
        return undefined
      } finally {
        setPendingOperation(undefined)
      }
    },
    [
      client,
      input.localRuntime,
      input.platform.workspace,
      input.preference.confirmedCloudUploadAt,
      input.userStoryId,
      input.worktree,
      pendingOperation,
      profile,
      session,
    ]
  )

  return {
    control,
    pendingOperation,
    runtime: session
      ? cloudRuntimeState(session, input.localRuntime)
      : cloudIdleRuntime(input.localRuntime),
    session,
  }
}

function cloudIdleRuntime(
  local?: ProjectPreviewRuntimeState
): ProjectPreviewRuntimeState | undefined {
  if (!local) return undefined
  return {
    ...local,
    desiredStatus: "stopped",
    previewUrl: undefined,
    statuses: Object.fromEntries(
      local.configurations.map(({ id }) => [id, "stopped"])
    ),
  }
}

function cloudRuntimeState(
  session: PreviewSessionView,
  local?: ProjectPreviewRuntimeState
): ProjectPreviewRuntimeState {
  const selected =
    session.selection?.configurationId ?? local?.selectedConfigurationId
  const running = session.state.engine === "running"
  const route = session.endpointMap?.routes.find(
    ({ endpointId }) => endpointId === session.endpointMap?.primaryEndpointId
  )
  const previewUrl =
    session.endpointMap?.integratedPreviewRequired && route
      ? `http://localhost:${route.logicalPort}`
      : session.endpointMap?.primaryPublicUrl
  return {
    configurations: local?.configurations ?? [],
    desiredStatus:
      session.desired.services === "running" ? "running" : "stopped",
    previewUrl,
    selectedConfigurationId: selected,
    statuses: Object.fromEntries(
      (local?.configurations ?? []).map(({ id }) => [
        id,
        id === selected ? (running ? "running" : "stopped") : "stopped",
      ])
    ),
  }
}

function cloudSessionStorageId(userStoryId: string) {
  return `blame.preview-session.${userStoryId}`
}

function cloudCreateOperationStorageId(userStoryId: string) {
  return `blame.preview-create-operation.${userStoryId}`
}

async function pendingCloudCreateOperation(
  userStoryId: string,
  profile: string,
  manifestText: string
) {
  const storageId = cloudCreateOperationStorageId(userStoryId)
  const fingerprint = await crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(`${profile}\0${manifestText}`))
    .then((value) =>
      Array.from(new Uint8Array(value), (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("")
    )
  try {
    const pending = JSON.parse(localStorage.getItem(storageId) ?? "null") as {
      fingerprint?: unknown
      operationId?: unknown
    } | null
    if (
      pending?.fingerprint === fingerprint &&
      typeof pending.operationId === "string"
    ) {
      return pending.operationId
    }
  } catch {
    localStorage.removeItem(storageId)
  }
  const operationId = crypto.randomUUID()
  localStorage.setItem(storageId, JSON.stringify({ fingerprint, operationId }))
  return operationId
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
