import { InfoIcon, LoaderCircleIcon, PlusIcon } from "lucide-react"

import {
  type BacklogAction,
  backlogColumns,
  type BacklogColumnId,
  type UserStory,
} from "@/components/backlog/data/backlog-data"
import type { OpenDrawer } from "@/components/backlog/shared/backlog-types"
import { UserStoryCard } from "@/components/backlog/board/user-story-card"
import type {
  RejectChoice,
  StopAgentChoice,
} from "@/components/backlog/actions/story-action-dialogs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
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
  onAction,
  onCreateUserStory,
  onOpenDrawer,
  onOpenWorktree,
  onReject,
  onStopAgent,
  onUnpauseAgent,
  queueInitializing,
  stories,
}: {
  column: (typeof backlogColumns)[number]
  onAction: (
    story: UserStory,
    action: BacklogAction
  ) => Promise<UserStory | void>
  onCreateUserStory: () => void
  onOpenDrawer: OpenDrawer
  onOpenWorktree: (story: UserStory) => Promise<void>
  onReject: (story: UserStory, choice: RejectChoice) => Promise<UserStory>
  onStopAgent: (story: UserStory, choice: StopAgentChoice) => Promise<UserStory>
  onUnpauseAgent: (story: UserStory) => Promise<UserStory>
  queueInitializing?: boolean
  stories: UserStory[]
}) {
  return (
    <section className="flex min-h-136 flex-col overflow-hidden rounded-lg border bg-muted/30">
      <ColumnHeader
        column={column}
        count={stories.length}
        queueInitializing={queueInitializing}
      />
      <div className="flex flex-1 flex-col gap-3 bg-foreground/5 p-3 dark:bg-background">
        {stories.map((story) => (
          <UserStoryCard
            key={story.id}
            onAction={onAction}
            onOpenDrawer={onOpenDrawer}
            onOpenWorktree={onOpenWorktree}
            onReject={onReject}
            onStopAgent={onStopAgent}
            onUnpauseAgent={onUnpauseAgent}
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
  queueInitializing,
}: {
  column: (typeof backlogColumns)[number]
  count: number
  queueInitializing?: boolean
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
          {queueInitializing && (
            <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <LoaderCircleIcon className="size-3 animate-spin" />
              Project initialization in progress
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
                    aria-label="Project initialization details"
                  >
                    <InfoIcon className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-64 text-pretty">
                  Blame is analyzing the project setup and code practices. This
                  only happens the first time the project is opened; afterwards,
                  the result is saved.
                </TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>
      </div>
      <Badge variant="secondary">{count}</Badge>
    </div>
  )
}
