export type PreviewContainerFailure =
  | "preview_container_missing"
  | "preview_container_stopped";

type PreviewContainerState = {
  discoveryGraceMs: number;
  elapsedMs: number;
  found: boolean;
  health?: string;
  status?: string;
};

export function previewContainerFailure(
  state: PreviewContainerState,
): PreviewContainerFailure | undefined {
  if (!state.found) {
    return state.elapsedMs < state.discoveryGraceMs
      ? undefined
      : "preview_container_missing";
  }
  if (state.health === "unhealthy" || failedContainerStatus(state.status)) {
    return "preview_container_stopped";
  }
  return undefined;
}

function failedContainerStatus(status: string | undefined) {
  return status === "dead" || status === "exited" || status === "removing";
}
