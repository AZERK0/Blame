import { PlusIcon } from "lucide-react"

import {
  backlogColumns,
  type BacklogColumnId,
  type UserStory,
} from "@/components/backlog/data/backlog-data"
import type { OpenDrawer } from "@/components/backlog/shared/backlog-types"
import { UserStoryCard } from "@/components/backlog/board/user-story-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const columnColors = {
  backlog: "border-emerald-500",
  ready: "border-blue-500",
  "in-progress": "border-amber-500",
  "in-review": "border-violet-500",
  done: "border-orange-500",
  discarded: "border-rose-500",
} satisfies Record<BacklogColumnId, string>

export function BacklogColumn({
  column,
  onCreateUserStory,
  onOpenDrawer,
  stories,
}: {
  column: (typeof backlogColumns)[number]
  onCreateUserStory: () => void
  onOpenDrawer: OpenDrawer
  stories: UserStory[]
}) {
  return (
    <section className="flex min-h-136 flex-col overflow-hidden rounded-lg border bg-muted/30">
      <ColumnHeader column={column} count={stories.length} />
      <div className="flex flex-1 flex-col gap-3 bg-foreground/5 p-3 dark:bg-background">
        {stories.map((story) => (
          <UserStoryCard
            key={story.id}
            onOpenDrawer={onOpenDrawer}
            story={story}
          />
        ))}
        {column.id === "backlog" && (
          <Button
            type="button"
            variant="ghost"
            className="flex h-8 items-center justify-center gap-2 rounded-md text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={onCreateUserStory}
          >
            <PlusIcon className="size-4" />
            New User Story
          </Button>
        )}
      </div>
    </section>
  )
}

function ColumnHeader({
  column,
  count,
}: {
  column: (typeof backlogColumns)[number]
  count: number
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b p-4">
      <div className="flex min-w-0 items-start gap-2.5">
        <span
          className={cn(
            "mt-1.5 size-3 rounded-full border-2",
            columnColors[column.id]
          )}
        />
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold">{column.title}</h3>
          <p className="truncate text-xs text-muted-foreground">
            {column.description}
          </p>
        </div>
      </div>
      <Badge variant="secondary">{count}</Badge>
    </div>
  )
}
