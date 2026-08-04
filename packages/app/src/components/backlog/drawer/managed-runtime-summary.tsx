import type { UserStoryPreviewRunner } from "@/components/backlog/drawer/use-user-story-preview-runner"

export function ManagedRuntimeSummary({
  runner,
}: {
  runner: UserStoryPreviewRunner
}) {
  if (runner.profile === "local-container") return null
  const seconds = runner.usage?.activeSeconds ?? 0
  const duration =
    seconds >= 60
      ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
      : `${seconds}s`
  const cost = runner.usage?.estimatedCostUsd ?? 0
  return (
    <div
      className="pointer-events-auto rounded-full border bg-background/95 px-2.5 py-1.5 text-xs whitespace-nowrap text-muted-foreground shadow-sm backdrop-blur"
      title="Managed preview profile, provisioned time, and estimated infrastructure cost"
    >
      Cloud preview
      {` · ${duration} · $${cost.toFixed(4)}`}
    </div>
  )
}
