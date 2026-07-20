import { LoaderCircleIcon } from "lucide-react"

import {
  type BacklogAction,
  type UserStory,
  userStoryDisplayId,
} from "@/components/backlog/data/backlog-data"
import type {
  RejectChoice,
  StopAgentChoice,
} from "@/components/backlog/actions/story-action-dialogs"
import {
  storyDetail,
  storyStatus,
} from "@/components/backlog/shared/backlog-helpers"
import type { UserStoryDiffStats } from "@/components/backlog/development/user-story-diff-stats"
import { StoryStatusBadge } from "@/components/backlog/shared/backlog-status-badge"
import { UserStoryTitleCloud } from "@/components/backlog/shared/user-story-title-cloud"
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

type UserStoryCardBodyProps = {
  cleanup?: boolean
  interactive?: boolean
  onOpenDrawer?: OpenDrawer
  setupInitializing?: boolean
  story: UserStory
  titleGenerating?: boolean
}

export function UserStoryCard({
  diffStats,
  onAction,
  onDeleteUserStory,
  onOpenDrawer,
  onOpenWorktree,
  onReject,
  reviewDiffEmpty,
  onStopAgent,
  onUnpauseAgent,
  cleanup,
  setupInitializing,
  story,
  titleGenerating,
}: {
  diffStats?: UserStoryDiffStats
  onAction: (
    story: UserStory,
    action: BacklogAction
  ) => Promise<UserStory | void>
  onDeleteUserStory: (story: UserStory) => Promise<void>
  onOpenDrawer: OpenDrawer
  onOpenWorktree: (story: UserStory) => Promise<void>
  onReject: (story: UserStory, choice: RejectChoice) => Promise<UserStory>
  reviewDiffEmpty?: boolean
  onStopAgent: (story: UserStory, choice: StopAgentChoice) => Promise<UserStory>
  onUnpauseAgent: (story: UserStory) => Promise<UserStory>
  cleanup?: boolean
  setupInitializing?: boolean
  story: UserStory
  titleGenerating?: boolean
}) {
  return (
    <div className="user-story-state-effect" data-story-state={story.status}>
      <Card
        size="sm"
        className="group/user-story relative z-1 rounded-lg bg-white! dark:bg-neutral-900!"
      >
        <UserStoryCardBody
          cleanup={cleanup}
          onOpenDrawer={onOpenDrawer}
          setupInitializing={setupInitializing}
          story={story}
          titleGenerating={titleGenerating}
        />
        <CardFooter>
          <StoryActions
            diffStats={diffStats}
            onAction={onAction}
            onDeleteUserStory={onDeleteUserStory}
            onOpenDrawer={onOpenDrawer}
            onOpenWorktree={onOpenWorktree}
            onReject={onReject}
            reviewDiffEmpty={reviewDiffEmpty}
            onStopAgent={onStopAgent}
            onUnpauseAgent={onUnpauseAgent}
            story={story}
          />
        </CardFooter>
      </Card>
    </div>
  )
}

export function ReadOnlyUserStoryCard({ story }: { story: UserStory }) {
  return (
    <div className="user-story-state-effect" data-story-state={story.status}>
      <Card
        size="sm"
        className="group/user-story relative z-1 rounded-lg bg-white! dark:bg-neutral-900!"
      >
        <UserStoryCardBody interactive={false} story={story} />
      </Card>
    </div>
  )
}

function UserStoryCardBody({
  cleanup,
  interactive = true,
  onOpenDrawer,
  setupInitializing,
  story,
  titleGenerating,
}: UserStoryCardBodyProps) {
  return (
    <>
      <CardHeader className="gap-0 has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
        <p className="text-xs font-medium text-muted-foreground">
          {userStoryLabel(story)}
        </p>
        {setupInitializing && (
          <StoryProgressLabel label="Initializing story setup" />
        )}
        {cleanup && <StoryProgressLabel label="Removing story worktree" />}
        <CardTitle className="min-w-0 text-base leading-snug">
          {interactive && onOpenDrawer ? (
            <Button
              type="button"
              variant="link"
              className="h-auto max-w-full min-w-0 shrink justify-start p-0 text-left text-base leading-snug font-medium break-words whitespace-normal text-card-foreground transition-colors group-hover/user-story:text-blue-600 hover:cursor-pointer dark:group-hover/user-story:text-blue-300"
              onClick={() => onOpenDrawer(drawerTarget(story))}
            >
              <UserStoryTitleCloud
                active={titleGenerating}
                className="block w-full"
              >
                <span className="block break-words">
                  {story.title}
                </span>
              </UserStoryTitleCloud>
            </Button>
          ) : (
            <UserStoryTitleCloud
              active={titleGenerating}
              className="block w-full"
            >
              <span className="block break-words text-card-foreground">
                {story.title}
              </span>
            </UserStoryTitleCloud>
          )}
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
    </>
  )
}

function StoryProgressLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <LoaderCircleIcon className="size-3 animate-spin" />
      {label}
    </div>
  )
}

function drawerTarget(story: UserStory) {
  return {
    userStory: story,
    mode:
      story.status === "backlog" || story.status === "discarded"
        ? "edit"
        : "view",
    initialTab: "user-story",
  } as const
}

function userStoryLabel(story: UserStory) {
  return userStoryDisplayId(story)
}
