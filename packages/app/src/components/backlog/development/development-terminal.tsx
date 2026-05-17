import { ServerOffIcon, TerminalIcon } from "lucide-react"
import type * as React from "react"

import type { UserStory } from "@/components/backlog/data/backlog-data"

export function DevelopmentTerminal({ userStory }: { userStory?: UserStory }) {
  if (!userStory?.worktree) {
    return (
      <TerminalEmptyState
        description="This user story does not have a worktree yet."
        icon={TerminalIcon}
        title="No worktree"
      />
    )
  }

  return (
    <TerminalEmptyState
      description="Terminal execution will be restored through the Cline runtime after the first SDK migration."
      icon={ServerOffIcon}
      title="Terminal unavailable"
    />
  )
}

function TerminalEmptyState({
  description,
  icon: Icon,
  title,
}: {
  description: string
  icon: React.ComponentType<{ className?: string }>
  title: string
}) {
  return (
    <div className="flex h-full min-h-96 flex-col items-center justify-center gap-3 bg-muted/20 p-8 text-center">
      <Icon className="size-8 text-muted-foreground" />
      <div>
        <h3 className="font-heading text-lg font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}
