import type {
  BacklogColumnId,
  UserStory,
} from "@/components/backlog/data/backlog-data"
import type {
  DrawerAction,
  UserStoryDevelopmentTab,
  UserStoryDrawerMode,
} from "@/components/backlog/shared/backlog-types"

export function activityItems(status: BacklogColumnId, userStory?: UserStory) {
  const items = [
    `${userStory?.owner ?? "Product"} created ${userStory?.id ?? "this draft"}.`,
    "User story details were updated.",
  ]
  if (status !== "backlog") items.push("Moved from Backlog to Agent Queue.")
  if (status === "in-progress" || status === "in-review" || status === "done") {
    items.push("Agent created a dedicated worktree.")
  }
  if (status === "in-review" || status === "done")
    items.push("Agent submitted work for review.")
  if (status === "done") items.push("Approved and merged into the main branch.")
  if (status === "discarded")
    items.push("User story was rejected or cancelled.")
  return items
}

export function commentButtonLabel(
  status: BacklogColumnId,
  userStory?: UserStory
) {
  if (status === "in-progress") return "Pause & Give Feedback"
  if (status === "in-review") return "Request Changes"
  if (status === "done") return "Comment"
  if (userStory?.status === "backlog") return "Comment"
  return "Comment"
}

export function drawerActions(
  mode: UserStoryDrawerMode,
  status: BacklogColumnId
): DrawerAction[] {
  if (mode === "create") return ["Cancel", "Save as Draft", "Send to Dev Agent"]
  if (status === "backlog")
    return ["Cancel", "Save Changes", "Send to Dev Agent"]
  if (status === "ready") return ["Dequeue"]
  if (status === "in-progress") return ["Stop Agent"]
  if (status === "in-review")
    return ["Request Changes", "Reject", "Approve & Merge"]
  if (status === "done") return ["Close"]
  return ["Rework as Draft"]
}

export function hasDevelopmentTab(status: BacklogColumnId) {
  return (
    status === "backlog" ||
    status === "ready" ||
    status === "in-progress" ||
    status === "in-review" ||
    status === "done"
  )
}

export function isEditable(mode: UserStoryDrawerMode, status: BacklogColumnId) {
  return mode === "create" || status === "backlog" || status === "discarded"
}

export function normalizeDevelopmentTab(
  status: BacklogColumnId,
  tab: UserStoryDevelopmentTab
) {
  if (status === "backlog" || status === "ready") return "files"
  if (status === "done") return "diff"
  return tab
}
