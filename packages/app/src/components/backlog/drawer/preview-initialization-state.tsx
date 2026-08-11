import type {
  PreviewLifecyclePhase,
  PreviewLifecycleState,
} from "@blame/agent-runtime"

export function PreviewInitializationState({
  lifecycle,
}: {
  lifecycle?: PreviewLifecycleState
} = {}) {
  const copy = previewLifecycleCopy(lifecycle?.phase)
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-5 bg-background p-8 text-center">
      <div className="space-y-1">
        <h3 className="font-heading text-lg font-semibold">{copy.title}</h3>
        <p className="text-sm text-muted-foreground">{copy.description}</p>
      </div>
      <div className="h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-muted">
        <div className="h-full w-full animate-pulse rounded-full bg-primary/70" />
      </div>
    </div>
  )
}

function previewLifecycleCopy(phase: PreviewLifecyclePhase | undefined) {
  switch (phase) {
    case "provisioning":
      return {
        title: "Provisioning preview",
        description: "Creating the isolated preview environment.",
      }
    case "resuming":
      return {
        title: "Resuming preview",
        description: "Restoring the isolated preview environment.",
      }
    case "synchronizing":
      return {
        title: "Synchronizing preview",
        description: "Sending the current story workspace to the runtime.",
      }
    case "loading":
      return {
        title: "Loading preview",
        description: "Publishing and checking the preview endpoint.",
      }
    case "preparing":
      return {
        title: "Preparing preview",
        description: "Preparing containers and runtime dependencies.",
      }
    case "starting":
      return {
        title: "Starting preview",
        description: "Starting services and waiting for readiness checks.",
      }
    default:
      return {
        title: "Initializing preview",
        description: "Preparing the isolated worktree and its containers.",
      }
  }
}
