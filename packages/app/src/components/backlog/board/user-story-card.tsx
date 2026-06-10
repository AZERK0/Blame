import { LoaderCircleIcon } from "lucide-react"

import {
  type BacklogAction,
  type UserStory,
} from "@/components/backlog/data/backlog-data"
import type {
  RejectChoice,
  StopAgentChoice,
} from "@/components/backlog/actions/story-action-dialogs"
import {
  storyDetail,
  storyStatus,
} from "@/components/backlog/shared/backlog-helpers"
import { StoryStatusBadge } from "@/components/backlog/shared/backlog-status-badge"
import type { OpenDrawer } from "@/components/backlog/shared/backlog-types"
import { StoryActions } from "@/components/backlog/actions/story-actions"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export function UserStoryCard({
  onAction,
  onDeleteUserStory,
  onOpenDrawer,
  onOpenWorktree,
  onReject,
  onStopAgent,
  onUnpauseAgent,
  cleanup,
  setupInitializing,
  story,
}: {
  onAction: (
    story: UserStory,
    action: BacklogAction
  ) => Promise<UserStory | void>
  onDeleteUserStory: (story: UserStory) => Promise<void>
  onOpenDrawer: OpenDrawer
  onOpenWorktree: (story: UserStory) => Promise<void>
  onReject: (story: UserStory, choice: RejectChoice) => Promise<UserStory>
  onStopAgent: (story: UserStory, choice: StopAgentChoice) => Promise<UserStory>
  onUnpauseAgent: (story: UserStory) => Promise<UserStory>
  cleanup?: boolean
  setupInitializing?: boolean
  story: UserStory
}) {
  return (
    <div className="user-story-state-effect" data-story-state={story.status}>
      <Card
        size="sm"
        className="group/user-story relative z-1 rounded-lg bg-white! dark:bg-neutral-900!"
      >
        <CardHeader className="gap-0 has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
          <p className="text-xs font-medium text-muted-foreground">
            {userStoryLabel(story)}
          </p>
          {setupInitializing && (
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <LoaderCircleIcon className="size-3 animate-spin" />
              Initializing story setup
            </div>
          )}
          {cleanup && (
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <LoaderCircleIcon className="size-3 animate-spin" />
              Removing story worktree
            </div>
          )}
          <CardTitle className="min-w-0 text-base leading-snug">
            <Button
              type="button"
              variant="link"
              className="h-auto max-w-full min-w-0 shrink justify-start p-0 text-left text-base leading-snug font-medium break-words whitespace-normal text-card-foreground transition-colors group-hover/user-story:text-blue-600 hover:cursor-pointer dark:group-hover/user-story:text-blue-300"
              onClick={() =>
                onOpenDrawer({
                  userStory: story,
                  mode:
                    story.status === "backlog" || story.status === "discarded"
                      ? "edit"
                      : "view",
                  initialTab: "user-story",
                })
              }
            >
              {story.title}
            </Button>
          </CardTitle>
          {storyStatus(story) && (
            <CardAction>
              <StoryStatusBadge status={storyStatus(story)} />
            </CardAction>
          )}
        </CardHeader>
        {storyDetail(story) && (
          <CardContent>
            <p className="text-xs font-medium text-muted-foreground">
              {storyDetail(story)}
            </p>
          </CardContent>
        )}
        <CardFooter>
          <StoryActions
            onAction={onAction}
            onDeleteUserStory={onDeleteUserStory}
            onOpenDrawer={onOpenDrawer}
            onOpenWorktree={onOpenWorktree}
            onReject={onReject}
            onStopAgent={onStopAgent}
            onUnpauseAgent={onUnpauseAgent}
            story={story}
          />
        </CardFooter>
      </Card>
    </div>
  )
}

function userStoryLabel(story: UserStory) {
  return `US-${String(story.id).padStart(3, "0")}`
}
