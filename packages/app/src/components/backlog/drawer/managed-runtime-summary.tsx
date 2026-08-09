import * as React from "react"
import type { UserStoryPreviewRunner } from "@/components/backlog/drawer/use-user-story-preview-runner"

export function ManagedRuntimeSummary({
  runner,
}: {
  runner: UserStoryPreviewRunner
}) {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (runner.runtime?.desiredStatus !== "running") return
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [runner.runtime?.desiredStatus])
  if (runner.profile === "local-container") return null
  const sampledSeconds = runner.usage?.activeSeconds ?? 0
  const observedAt = runner.usage?.observedAt
    ? Date.parse(runner.usage.observedAt)
    : Number.NaN
  const liveSeconds =
    runner.runtime?.desiredStatus === "running" && Number.isFinite(observedAt)
      ? Math.max(0, Math.floor((now - observedAt) / 1000))
      : 0
  const seconds = sampledSeconds + liveSeconds
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
      {` · ${duration} · $${cost.toFixed(6)}`}
    </div>
  )
}
