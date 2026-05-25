import type {
  UserStory,
  UserStoryDraft,
  UserStoryUpdate,
} from "@/components/backlog/data/backlog-data"
import type {
  RejectChoice,
  StopAgentChoice,
} from "@/components/backlog/actions/story-action-dialogs"
import type {
  OpenDrawer,
  UserStoryDevelopmentTab,
  UserStoryDrawerMode,
  UserStoryDrawerTab,
} from "@/components/backlog/shared/backlog-types"
import { UserStoryDrawerPanel } from "@/components/backlog/drawer/user-story-drawer-panel"
import { Drawer } from "@/components/ui/drawer"

export type {
  UserStoryDevelopmentTab,
  UserStoryDrawerMode,
  UserStoryDrawerTab,
} from "@/components/backlog/shared/backlog-types"

export type UserStoryDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  userStory?: UserStory
  mode: UserStoryDrawerMode
  initialTab?: UserStoryDrawerTab
  initialDevelopmentTab?: UserStoryDevelopmentTab
  focusComment?: boolean
  onCreateUserStory: (
    input: Omit<UserStoryDraft, "projectId">
  ) => Promise<UserStory>
  onOpenDrawer: OpenDrawer
  onReject: (story: UserStory, choice: RejectChoice) => Promise<UserStory>
  onStopAgent: (story: UserStory, choice: StopAgentChoice) => Promise<UserStory>
  onUpdateUserStory: (
    story: UserStory,
    input: UserStoryUpdate
  ) => Promise<UserStory>
}

export function UserStoryDrawer({
  open,
  onOpenChange,
  userStory,
  mode,
  initialTab = "user-story",
  initialDevelopmentTab = "files",
  focusComment,
  onCreateUserStory,
  onOpenDrawer,
  onReject,
  onStopAgent,
  onUpdateUserStory,
}: UserStoryDrawerProps) {
  const status = userStory?.status ?? "backlog"
  const drawerKey = [
    mode,
    userStory?.id ?? "draft",
    status,
    initialTab,
    initialDevelopmentTab,
    focusComment ? "comment" : "default",
  ].join(":")

  return (
    <Drawer
      direction="right"
      open={open}
      onOpenChange={onOpenChange}
      handleOnly={true}
    >
      <UserStoryDrawerPanel
        key={drawerKey}
        focusComment={focusComment}
        initialDevelopmentTab={initialDevelopmentTab}
        initialTab={initialTab}
        mode={mode}
        onCancel={() => onOpenChange(false)}
        onCreateUserStory={onCreateUserStory}
        onOpenDrawer={onOpenDrawer}
        onReject={onReject}
        onStopAgent={onStopAgent}
        onUpdateUserStory={onUpdateUserStory}
        status={status}
        userStory={userStory}
      />
    </Drawer>
  )
}
