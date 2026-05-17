import {
  type UserStory,
  userStoryActions,
} from "@/components/backlog/data/backlog-data"
import type { OpenDrawer } from "@/components/backlog/shared/backlog-types"
import { StoryAction } from "@/components/backlog/actions/story-action-button"
import {
  RejectDialog,
  StopAgentDialog,
} from "@/components/backlog/actions/story-action-dialogs"
import { Separator } from "@/components/ui/separator"

export function StoryActions({
  onOpenDrawer,
  story,
}: {
  onOpenDrawer: OpenDrawer
  story: UserStory
}) {
  if (story.status === "in-review") {
    return <ReviewActions onOpenDrawer={onOpenDrawer} story={story} />
  }

  if (story.status === "in-progress") {
    return <ProgressActions onOpenDrawer={onOpenDrawer} story={story} />
  }

  return (
    <div className="flex w-full justify-end">
      {userStoryActions(story).map((action) => (
        <StoryAction
          key={action}
          action={action}
          onOpenDrawer={onOpenDrawer}
          story={story}
        />
      ))}
    </div>
  )
}

function ProgressActions({
  onOpenDrawer,
  story,
}: {
  onOpenDrawer: OpenDrawer
  story: UserStory
}) {
  return (
    <div className="grid w-full gap-2">
      <DevelopmentActions onOpenDrawer={onOpenDrawer} story={story} />
      <Separator className="my-1" />
      <div className="grid grid-cols-2 gap-2">
        <StoryAction
          action="Open Worktree"
          story={story}
          onOpenDrawer={onOpenDrawer}
        />
        <StoryAction
          action="Open Preview"
          story={story}
          onOpenDrawer={onOpenDrawer}
        />
      </div>
      <div className="flex justify-end">
        <StopAgentDialog onOpenDrawer={onOpenDrawer} story={story} />
      </div>
    </div>
  )
}

function ReviewActions({
  onOpenDrawer,
  story,
}: {
  onOpenDrawer: OpenDrawer
  story: UserStory
}) {
  return (
    <div className="grid w-full gap-2">
      <DevelopmentActions onOpenDrawer={onOpenDrawer} story={story} />
      <Separator className="my-1" />
      <div className="grid grid-cols-2 gap-2">
        <StoryAction
          action="Open Worktree"
          onOpenDrawer={onOpenDrawer}
          story={story}
        />
        <StoryAction
          action="Open Preview"
          onOpenDrawer={onOpenDrawer}
          story={story}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <RejectDialog onOpenDrawer={onOpenDrawer} story={story} />
        <StoryAction
          action="Approve & Merge"
          onOpenDrawer={onOpenDrawer}
          story={story}
        />
      </div>
    </div>
  )
}

function DevelopmentActions({
  onOpenDrawer,
  story,
}: {
  onOpenDrawer: OpenDrawer
  story: UserStory
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <StoryAction
        action="View Diff"
        label="Diff"
        onOpenDrawer={onOpenDrawer}
        story={story}
      />
      <StoryAction
        action="View Files"
        label="Files"
        onOpenDrawer={onOpenDrawer}
        story={story}
      />
      <StoryAction
        action="View Terminal"
        label="Terminal"
        onOpenDrawer={onOpenDrawer}
        story={story}
      />
    </div>
  )
}
