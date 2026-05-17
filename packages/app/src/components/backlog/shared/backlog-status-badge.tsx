import type { BacklogColumnId } from "@/components/backlog/data/backlog-data"
import { Badge } from "@/components/ui/badge"

export function StoryStatusBadge({
  status,
}: {
  status: string | undefined
}) {
  if (!status) return null

  if (status === "Draft") {
    return (
      <Badge
        variant="outline"
        className="border-muted-foreground/30 bg-muted text-muted-foreground"
      >
        {status}
      </Badge>
    )
  }

  if (status.startsWith("Queue #")) {
    return (
      <Badge
        variant="outline"
        className="border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300"
      >
        {status}
      </Badge>
    )
  }

  if (status === "Running") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      >
        {status}
      </Badge>
    )
  }

  if (status === "Paused") {
    return (
      <Badge
        variant="outline"
        className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
      >
        {status}
      </Badge>
    )
  }

  if (status === "Merged") {
    return (
      <Badge
        variant="outline"
        className="border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300"
      >
        {status}
      </Badge>
    )
  }

  if (status === "Rejected") {
    return (
      <Badge
        variant="outline"
        className="border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
      >
        {status}
      </Badge>
    )
  }

  return (
    <Badge
      variant="outline"
      className="border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300"
    >
      {status}
    </Badge>
  )
}

export function ColumnStatusBadge({ status }: { status: BacklogColumnId }) {
  if (status === "backlog") {
    return (
      <Badge
        variant="outline"
        className="border-muted-foreground/30 bg-muted text-muted-foreground"
      >
        {statusLabel(status)}
      </Badge>
    )
  }

  if (status === "ready") {
    return (
      <Badge
        variant="outline"
        className="border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300"
      >
        {statusLabel(status)}
      </Badge>
    )
  }

  if (status === "in-progress") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      >
        {statusLabel(status)}
      </Badge>
    )
  }

  if (status === "done") {
    return (
      <Badge
        variant="outline"
        className="border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300"
      >
        {statusLabel(status)}
      </Badge>
    )
  }

  if (status === "discarded") {
    return (
      <Badge
        variant="outline"
        className="border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
      >
        {statusLabel(status)}
      </Badge>
    )
  }

  return (
    <Badge
      variant="outline"
      className="border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300"
    >
      {statusLabel(status)}
    </Badge>
  )
}

function statusLabel(status: BacklogColumnId) {
  if (status === "ready") return "Agent Queue"
  if (status === "in-progress") return "In Progress"
  if (status === "in-review") return "In Review"
  return status[0].toUpperCase() + status.slice(1)
}
