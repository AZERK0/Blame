import type { ProjectPreviewRuntimeState } from "@blame/agent-runtime"
import {
  previewSessionLifecycle,
  type PreviewSessionView,
} from "@blame/preview-runtime"

import { managedEmbeddedPreviewUrl } from "./managed-preview-url.ts"

export function idleManagedPreviewRuntime(
  local?: ProjectPreviewRuntimeState
): ProjectPreviewRuntimeState | undefined {
  if (!local) return undefined
  return {
    ...local,
    desiredStatus: "stopped",
    lifecycle: {
      phase: "idle",
      status: "idle",
      since: local.lifecycle?.since ?? new Date().toISOString(),
    },
    previewUrl: undefined,
    statuses: Object.fromEntries(
      local.configurations.map(({ id }) => [id, "stopped"])
    ),
  }
}

export function managedPreviewRuntimeState(
  session: PreviewSessionView,
  local?: ProjectPreviewRuntimeState
): ProjectPreviewRuntimeState {
  const selected =
    session.selection?.configurationId ?? local?.selectedConfigurationId
  const selectedStatus = managedPreviewConfigurationStatus(session)
  return {
    configurations: local?.configurations ?? [],
    desiredStatus:
      session.desired.services === "running" ? "running" : "stopped",
    lifecycle: previewSessionLifecycle(session),
    previewUrl: managedEmbeddedPreviewUrl(session.endpointMap),
    selectedConfigurationId: selected,
    statuses: Object.fromEntries(
      (local?.configurations ?? []).map(({ id }) => [
        id,
        id === selected ? selectedStatus : "stopped",
      ])
    ),
  }
}

export function managedPreviewReady(session: PreviewSessionView | undefined) {
  return Boolean(
    session?.desired.services === "running" &&
    session.state.host === "running" &&
    session.state.engine === "running" &&
    session.state.preview === "ready" &&
    session.endpointMap
  )
}

export function managedPreviewActive(session: PreviewSessionView | undefined) {
  return Boolean(
    session?.desired.services === "running" &&
    !["idle", "stopped", "failed"].includes(session.state.engine)
  )
}

function managedPreviewConfigurationStatus(
  session: PreviewSessionView
): "error" | "running" | "starting" | "stopped" {
  if (session.desired.services !== "running") return "stopped"
  if (
    session.state.host === "failed" ||
    session.state.engine === "failed" ||
    session.state.preview === "degraded"
  ) {
    return "error"
  }
  return session.state.engine === "running" ? "running" : "starting"
}
