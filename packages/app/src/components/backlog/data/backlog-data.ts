export type BacklogColumnId =
  | "backlog"
  | "ready"
  | "in-progress"
  | "in-review"
  | "done"
  | "discarded"

export type BacklogAction =
  | "Send to Dev Agent"
  | "Discard"
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
  | "Delete Permanently"

export type UserStoryPriority = "Low" | "Medium" | "High"
export type UserStoryAgentStatus = "Running" | "Paused"
export type UserStoryAgentUsage = {
  cacheReadTokens?: number
  cacheWriteTokens?: number
  cost?: number
  inputTokens: number
  outputTokens: number
  totalCacheReadTokens?: number
  totalCacheWriteTokens?: number
  totalCost?: number
  totalInputTokens: number
  totalOutputTokens: number
}
export type UserStoryAgentActivity = {
  id: string
  kind: "reasoning" | "message" | "tool" | "approval" | "notice"
  title: string
  detail: string
  status?: "running" | "completed" | "failed"
  iteration?: number
  messageKind?: "intermediate" | "final"
  parallelGroupId?: string
  toolCallId?: string
  toolName?: string
  detailArtifact?: string
  detailTruncated?: boolean
  originalDetailLength?: number
  createdAt: string
  updatedAt?: string
}

export type UserStoryCodeSelectionAttachment = {
  id: string
  content: string
  endLine: number
  path: string
  startLine: number
}

export type UserStoryFileAttachment = {
  id: string
  content: string
  name: string
  size: number
  type: string
}

export type UserStoryAgentRunKind = "initial" | "change-request" | "resume"
export type UserStoryAgentRunStatus = "running" | "completed" | "failed"
export type UserStoryAgentRun = {
  id: number
  userStoryId: number
  commentId?: number | null
  kind: UserStoryAgentRunKind
  clineSessionId?: string | null
  status: UserStoryAgentRunStatus
  activities?: UserStoryAgentActivity[] | null
  finalResponse?: string | null
  usage?: UserStoryAgentUsage | null
  sessionSummary?: string | null
  completedAt?: string | null
  createdAt: string
  updatedAt?: string | null
}

export type UserStoryComment = {
  id: number
  userStoryId: number
  body: string
  codeSelectionAttachments?: UserStoryCodeSelectionAttachment[] | null
  fileAttachments?: UserStoryFileAttachment[] | null
  author: string
  createdAt: string
  updatedAt?: string | null
}

export type UserStory = {
  id: number
  projectId: string
  title: string
  summary: string
  codeSelectionAttachments?: UserStoryCodeSelectionAttachment[] | null
  fileAttachments?: UserStoryFileAttachment[] | null
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
  agentActivities?: UserStoryAgentActivity[] | null
  agentFinalResponse?: string | null
  agentUsage?: UserStoryAgentUsage | null
  agentSessionSummary?: string | null
  agentRuns?: UserStoryAgentRun[]
  mergedAt?: string | null
  mergeCommit?: string | null
  baseCommit?: string | null
  discardedReason?: string | null
  comments?: UserStoryComment[]
  createdAt: string
  updatedAt?: string | null
}

export type UserStoryDraft = {
  projectId: string
  title: string
  summary: string
  codeSelectionAttachments?: UserStoryCodeSelectionAttachment[] | null
  fileAttachments?: UserStoryFileAttachment[] | null
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
    | "codeSelectionAttachments"
    | "fileAttachments"
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
    | "agentActivities"
    | "agentFinalResponse"
    | "agentUsage"
    | "agentSessionSummary"
    | "mergedAt"
    | "mergeCommit"
    | "baseCommit"
    | "discardedReason"
  >
> & {
  agentActivity?: UserStoryAgentActivity | null
  agentActivityUpdates?: UserStoryAgentActivity[]
}

export type UserStoryActivityDetail = {
  detail: string
}

export type UserStoryAgentRunDraft = {
  commentId?: number | null
  kind: UserStoryAgentRunKind
  clineSessionId?: string | null
  status?: UserStoryAgentRunStatus
}

export type UserStoryAgentRunUpdate = Partial<
  Pick<
    UserStoryAgentRun,
    | "activities"
    | "clineSessionId"
    | "completedAt"
    | "finalResponse"
    | "sessionSummary"
    | "status"
    | "usage"
  >
> & {
  agentActivity?: UserStoryAgentActivity | null
  agentActivityUpdates?: UserStoryAgentActivity[]
}

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
  if (story.status === "backlog") return ["Discard", "Send to Dev Agent"]
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
  return ["Delete Permanently", "Rework"]
}
