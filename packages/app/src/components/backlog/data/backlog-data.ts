export type BacklogColumnId =
  | "backlog"
  | "ready"
  | "in-progress"
  | "in-review"
  | "done"
  | "discarded"

export type BacklogAction =
  | "Send to Dev Agent"
  | "Dequeue"
  | "Open Worktree"
  | "Open Preview"
  | "Stop Agent"
  | "Unpause Agent"
  | "View Diff"
  | "View Files"
  | "View Terminal"
  | "Request Changes"
  | "Reject"
  | "Approve & Merge"
  | "Rework"

export type UserStoryPriority = "Low" | "Medium" | "High"
export type UserStoryAgentStatus = "Running" | "Paused"

export type UserStory = {
  id: number
  projectId: string
  title: string
  summary: string
  status: BacklogColumnId
  priority: UserStoryPriority
  owner: string
  branch?: string | null
  previewUrl?: string | null
  worktree?: string | null
  agentStatus?: UserStoryAgentStatus | null
  clineSessionId?: string | null
  agentProviderId?: string | null
  agentModelId?: string | null
  agentLastEvent?: string | null
  agentLastError?: string | null
  mergedAt?: string | null
  mergeCommit?: string | null
  discardedReason?: string | null
  createdAt: string
  updatedAt?: string | null
}

export type UserStoryDraft = {
  projectId: string
  title: string
  summary: string
  status?: BacklogColumnId
  priority?: UserStoryPriority
  owner?: string
}

export type UserStoryUpdate = Partial<
  Pick<
    UserStory,
    | "projectId"
    | "title"
    | "summary"
    | "status"
    | "priority"
    | "owner"
    | "branch"
    | "previewUrl"
    | "worktree"
    | "agentStatus"
    | "clineSessionId"
    | "agentProviderId"
    | "agentModelId"
    | "agentLastEvent"
    | "agentLastError"
    | "mergedAt"
    | "mergeCommit"
    | "discardedReason"
  >
>

export const backlogColumns = [
  {
    id: "backlog",
    title: "Backlog",
    description: "Draft user stories",
  },
  {
    id: "ready",
    title: "Agent Queue",
    description: "Ready for agents",
  },
  {
    id: "in-progress",
    title: "In Progress",
    description: "Active worktrees",
  },
  {
    id: "in-review",
    title: "In Review",
    description: "Waiting for validation",
  },
  {
    id: "done",
    title: "Done",
    description: "Merged user stories",
  },
  {
    id: "discarded",
    title: "Discarded",
    description: "Rejected or cancelled",
  },
] satisfies { id: BacklogColumnId; title: string; description: string }[]

export function userStoryActions(story: UserStory): BacklogAction[] {
  if (story.status === "backlog") return ["Send to Dev Agent"]
  if (story.status === "ready") return ["Dequeue"]
  if (story.status === "in-progress")
    return story.agentStatus === "Paused"
      ? ["Open Worktree", "Open Preview", "Unpause Agent", "Stop Agent"]
      : ["Open Worktree", "Open Preview", "Stop Agent"]
  if (story.status === "in-review")
    return [
      "Open Worktree",
      "Open Preview",
      "View Diff",
      "View Files",
      "View Terminal",
      "Request Changes",
      "Reject",
      "Approve & Merge",
    ]
  if (story.status === "done") return ["View Diff"]
  return ["Rework"]
}
