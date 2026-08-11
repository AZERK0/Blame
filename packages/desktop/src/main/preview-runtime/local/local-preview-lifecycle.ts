import type {
  PreviewLifecyclePhase,
  PreviewLifecycleState,
  ProjectPreviewRuntimeState,
} from "@blame/agent-runtime";
import type { PreviewRuntimeSelectionState } from "../../preview-run-state.js";

type WritePreviewRuntimeState = (
  worktree: string,
  state: PreviewRuntimeSelectionState,
) => Promise<void>;

export function localPreviewLifecycle(
  persisted: PreviewRuntimeSelectionState,
  selectedStatus: ProjectPreviewRuntimeState["statuses"][string] | undefined,
  browserPreview: boolean,
  previewUrl: string | undefined,
): PreviewLifecycleState {
  if (selectedStatus === "error") {
    return failedLocalPreviewLifecycle(
      persisted.lifecycle?.failure?.message ?? "A preview container failed.",
      persisted.lifecycle?.since,
    );
  }
  if (
    persisted.desiredStatus === "running" &&
    selectedStatus === "running" &&
    (!browserPreview || previewUrl)
  ) {
    return localLifecycle("ready", "ready", persisted.lifecycle);
  }
  if (persisted.desiredStatus === "stopped") {
    return selectedStatus === "running" || selectedStatus === "starting"
      ? localLifecycle("stopping", "pending", persisted.lifecycle)
      : idleLocalPreviewLifecycle(persisted.lifecycle?.since);
  }
  if (persisted.lifecycle?.status === "error") return persisted.lifecycle;
  if (selectedStatus === "running" && browserPreview && !previewUrl) {
    return localLifecycle("loading", "pending", persisted.lifecycle);
  }
  const pendingPhase = persisted.lifecycle?.phase;
  return localLifecycle(
    pendingPhase === "stopping" ? "stopping" : "starting",
    "pending",
    persisted.lifecycle,
  );
}

export function idleLocalPreviewLifecycle(
  since?: string,
): PreviewLifecycleState {
  return {
    phase: "idle",
    status: "idle",
    since: since ?? new Date().toISOString(),
  };
}

export function pendingLocalPreviewLifecycle(
  phase: Extract<PreviewLifecyclePhase, "starting" | "stopping">,
): PreviewLifecycleState {
  return { phase, status: "pending", since: new Date().toISOString() };
}

export async function persistLocalPreviewResult(
  worktree: string,
  result: ProjectPreviewRuntimeState,
  writeState: WritePreviewRuntimeState,
) {
  await writeState(worktree, {
    desiredStatus: result.desiredStatus,
    lifecycle: result.lifecycle ?? idleLocalPreviewLifecycle(),
    selectedConfigurationId: result.selectedConfigurationId,
  });
}

export async function persistLocalPreviewFailure(
  worktree: string,
  selectedConfigurationId: string,
  desiredStatus: PreviewRuntimeSelectionState["desiredStatus"],
  error: unknown,
  writeState: WritePreviewRuntimeState,
) {
  await writeState(worktree, {
    desiredStatus,
    lifecycle: failedLocalPreviewLifecycle(errorMessage(error)),
    selectedConfigurationId,
  });
}

export async function runLocalPreviewOperation(
  worktree: string,
  selectedConfigurationId: string,
  desiredStatus: PreviewRuntimeSelectionState["desiredStatus"],
  phase: Extract<PreviewLifecyclePhase, "starting" | "stopping">,
  operation: () => Promise<ProjectPreviewRuntimeState>,
  writeState: WritePreviewRuntimeState,
) {
  await writeState(worktree, {
    desiredStatus,
    lifecycle: pendingLocalPreviewLifecycle(phase),
    selectedConfigurationId,
  });
  try {
    const result = await operation();
    await persistLocalPreviewResult(worktree, result, writeState);
    return result;
  } catch (error) {
    await persistLocalPreviewFailure(
      worktree,
      selectedConfigurationId,
      desiredStatus,
      error,
      writeState,
    );
    throw error;
  }
}

export function validPreviewLifecycle(
  value: unknown,
): value is PreviewLifecycleState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const lifecycle = value as Record<string, unknown>;
  return (
    typeof lifecycle.phase === "string" &&
    [
      "idle",
      "provisioning",
      "resuming",
      "synchronizing",
      "preparing",
      "starting",
      "loading",
      "ready",
      "stopping",
      "suspending",
      "suspended",
      "destroying",
      "destroyed",
      "failed",
    ].includes(lifecycle.phase) &&
    typeof lifecycle.status === "string" &&
    ["idle", "pending", "ready", "error"].includes(lifecycle.status) &&
    typeof lifecycle.since === "string" &&
    Number.isFinite(Date.parse(lifecycle.since)) &&
    validFailure(lifecycle.failure)
  );
}

function validFailure(value: unknown) {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const failure = value as Record<string, unknown>;
  return (
    typeof failure.message === "string" &&
    (failure.retryable === undefined || typeof failure.retryable === "boolean")
  );
}

function failedLocalPreviewLifecycle(
  message: string,
  since?: string,
): PreviewLifecycleState {
  return {
    phase: "failed",
    status: "error",
    since: since ?? new Date().toISOString(),
    failure: { message: message.trim() || "The local preview failed." },
  };
}

function localLifecycle(
  phase: PreviewLifecyclePhase,
  status: PreviewLifecycleState["status"],
  previous?: PreviewLifecycleState,
): PreviewLifecycleState {
  return {
    phase,
    status,
    since:
      previous?.phase === phase ? previous.since : new Date().toISOString(),
  };
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === "string"
    ? error
    : "The local preview operation failed.";
}
