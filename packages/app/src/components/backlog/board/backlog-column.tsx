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
import { ScrollArea } from "@/components/ui/scroll-area"
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
  onDeleteUserStory,
  onOpenDrawer,
  onOpenWorktree,
  onReject,
  reviewDiffEmpty,
  onStopAgent,
  onUnpauseAgent,
  queueInitializing,
  storyCleanup,
  storySetupInitializing,
  stories,
}: {
  column: (typeof backlogColumns)[number]
  onAction: (
    story: UserStory,
    action: BacklogAction
  ) => Promise<UserStory | void>
  onCreateUserStory: () => void
  onDeleteUserStory: (story: UserStory) => Promise<void>
  onOpenDrawer: OpenDrawer
  onOpenWorktree: (story: UserStory) => Promise<void>
  onReject: (story: UserStory, choice: RejectChoice) => Promise<UserStory>
  reviewDiffEmpty?: (story: UserStory) => boolean
  onStopAgent: (story: UserStory, choice: StopAgentChoice) => Promise<UserStory>
  onUnpauseAgent: (story: UserStory) => Promise<UserStory>
  queueInitializing?: boolean
  storyCleanup?: (story: UserStory) => boolean
  storySetupInitializing?: (story: UserStory) => boolean
  stories: UserStory[]
}) {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-muted/30 shadow-xl ring-1 shadow-black/10 ring-foreground/15">
      <BacklogColumnHeader
        column={column}
        count={stories.length}
        queueInitializing={queueInitializing}
      />
      <ScrollArea className="min-h-0 flex-1 bg-foreground/5 dark:bg-background">
        <div className="flex flex-col gap-3 p-3">
          {stories.map((story) => (
            <UserStoryCard
              key={story.id}
              cleanup={storyCleanup?.(story)}
              onAction={onAction}
              onDeleteUserStory={onDeleteUserStory}
              onOpenDrawer={onOpenDrawer}
              onOpenWorktree={onOpenWorktree}
              onReject={onReject}
              reviewDiffEmpty={reviewDiffEmpty?.(story)}
              onStopAgent={onStopAgent}
              onUnpauseAgent={onUnpauseAgent}
              setupInitializing={
                storySetupInitializing?.(story) || queueInitializing
              }
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
      </ScrollArea>
    </section>
  )
}

export function BacklogColumnHeader({
  column,
  count,
  queueInitializing,
}: {
  column: BacklogColumnHeaderColumn
  count: number
  queueInitializing?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b bg-muted/30 p-4">
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

type BacklogColumnHeaderColumn = {
  description: string
  id: BacklogColumnId
  title: string
}
