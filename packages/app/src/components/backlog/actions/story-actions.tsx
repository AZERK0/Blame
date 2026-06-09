import {
  type UserStory,
  userStoryActions,
} from "@/components/backlog/data/backlog-data"
import type { OpenDrawer } from "@/components/backlog/shared/backlog-types"
import {
  type StoryActionHandler,
  StoryAction,
} from "@/components/backlog/actions/story-action-button"
import {
  type RejectChoice,
  type StopAgentChoice,
  DeleteUserStoryDialog,
  RejectDialog,
  StopAgentDialog,
} from "@/components/backlog/actions/story-action-dialogs"
import { Separator } from "@/components/ui/separator"

export function StoryActions({
  onAction,
  onOpenDrawer,
  onOpenWorktree,
  onDeleteUserStory,
  onReject,
  onStopAgent,
  onUnpauseAgent,
  story,
}: {
  onAction: StoryActionHandler
  onOpenDrawer: OpenDrawer
  onOpenWorktree: (story: UserStory) => Promise<void>
  onDeleteUserStory: (story: UserStory) => Promise<void>
  onReject: (story: UserStory, choice: RejectChoice) => Promise<UserStory>
  onStopAgent: (story: UserStory, choice: StopAgentChoice) => Promise<UserStory>
  onUnpauseAgent: (story: UserStory) => Promise<UserStory>
  story: UserStory
}) {
  if (story.status === "in-review") {
    return (
      <ReviewActions
        onAction={onAction}
        onOpenDrawer={onOpenDrawer}
        onOpenWorktree={onOpenWorktree}
        onReject={onReject}
        story={story}
      />
    )
  }

  if (story.status === "in-progress") {
    return (
      <ProgressActions
        onAction={onAction}
        onOpenDrawer={onOpenDrawer}
        onOpenWorktree={onOpenWorktree}
        onStopAgent={onStopAgent}
        onUnpauseAgent={onUnpauseAgent}
        story={story}
      />
    )
  }

  return (
    <div className="flex w-full justify-end gap-2">
      {userStoryActions(story).map((action) => (
        <UserStoryAction
          key={action}
          action={action}
          onAction={onAction}
          onDeleteUserStory={onDeleteUserStory}
          onOpenDrawer={onOpenDrawer}
          onOpenWorktree={onOpenWorktree}
          onStopAgent={onStopAgent}
          onUnpauseAgent={onUnpauseAgent}
          story={story}
        />
      ))}
    </div>
  )
}

function UserStoryAction({
  action,
  onAction,
  onDeleteUserStory,
  onOpenDrawer,
  onOpenWorktree,
  onStopAgent,
  onUnpauseAgent,
  story,
}: {
  action: ReturnType<typeof userStoryActions>[number]
  onAction: StoryActionHandler
  onDeleteUserStory: (story: UserStory) => Promise<void>
  onOpenDrawer: OpenDrawer
  onOpenWorktree: (story: UserStory) => Promise<void>
  onStopAgent: (story: UserStory, choice: StopAgentChoice) => Promise<UserStory>
  onUnpauseAgent: (story: UserStory) => Promise<UserStory>
  story: UserStory
}) {
  if (action === "Delete Permanently") {
    return (
      <DeleteUserStoryDialog
        onDeleteUserStory={onDeleteUserStory}
        story={story}
        triggerIconOnly
        triggerSize="icon-sm"
      />
    )
  }

  return (
    <StoryAction
      action={action}
      onAction={onAction}
      onOpenDrawer={onOpenDrawer}
      onOpenWorktree={onOpenWorktree}
      onStopAgent={onStopAgent}
      onUnpauseAgent={onUnpauseAgent}
      story={story}
    />
  )
}

function ProgressActions({
  onAction,
  onOpenDrawer,
  onOpenWorktree,
  onStopAgent,
  onUnpauseAgent,
  story,
}: {
  onAction: StoryActionHandler
  onOpenDrawer: OpenDrawer
  onOpenWorktree: (story: UserStory) => Promise<void>
  onStopAgent: (story: UserStory, choice: StopAgentChoice) => Promise<UserStory>
  onUnpauseAgent: (story: UserStory) => Promise<UserStory>
  story: UserStory
}) {
  return (
    <div className="grid w-full gap-2">
      <DevelopmentActions onOpenDrawer={onOpenDrawer} story={story} />
      <Separator className="my-1" />
      <div className="grid grid-cols-2 gap-2">
        <StoryAction
          action="Open Worktree"
          onAction={onAction}
          story={story}
          onOpenDrawer={onOpenDrawer}
          onOpenWorktree={onOpenWorktree}
        />
        <StoryAction
          action="Open Preview"
          onAction={onAction}
          story={story}
          onOpenDrawer={onOpenDrawer}
          onOpenWorktree={onOpenWorktree}
        />
      </div>
      <div className="flex justify-end gap-2">
        {story.agentStatus === "Paused" && (
          <StoryAction
            action="Unpause Agent"
            onAction={onAction}
            onOpenDrawer={onOpenDrawer}
            onOpenWorktree={onOpenWorktree}
            onUnpauseAgent={onUnpauseAgent}
            story={story}
          />
        )}
        <StopAgentDialog
          onOpenDrawer={onOpenDrawer}
          onStopAgent={onStopAgent}
          story={story}
        />
      </div>
    </div>
  )
}

function ReviewActions({
  onAction,
  onOpenDrawer,
  onOpenWorktree,
  onReject,
  story,
}: {
  onAction: StoryActionHandler
  onOpenDrawer: OpenDrawer
  onOpenWorktree: (story: UserStory) => Promise<void>
  onReject: (story: UserStory, choice: RejectChoice) => Promise<UserStory>
  story: UserStory
}) {
  return (
    <div className="grid w-full gap-2">
      <DevelopmentActions onOpenDrawer={onOpenDrawer} story={story} />
      <Separator className="my-1" />
      <div className="grid grid-cols-2 gap-2">
        <StoryAction
          action="Open Worktree"
          onAction={onAction}
          onOpenDrawer={onOpenDrawer}
          onOpenWorktree={onOpenWorktree}
          story={story}
        />
        <StoryAction
          action="Open Preview"
          onAction={onAction}
          onOpenDrawer={onOpenDrawer}
          onOpenWorktree={onOpenWorktree}
          story={story}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <RejectDialog
          onOpenDrawer={onOpenDrawer}
          onReject={onReject}
          story={story}
        />
        <StoryAction
          action="Approve & Merge"
          onAction={onAction}
          onOpenDrawer={onOpenDrawer}
          onOpenWorktree={onOpenWorktree}
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
