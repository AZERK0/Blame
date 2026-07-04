import type {
  UserStoryAgentActivity,
  UserStoryAgentRunKind,
  UserStoryAgentRunStatus,
  UserStoryAgentUsage,
  UserStoryCodeSelectionAttachment,
  UserStoryFileAttachment,
} from "@/components/backlog/data/backlog-data"

export type QuickChatAgentStatus = "Running" | "Paused"

export type QuickChatMessage = {
  author: string
  body: string
  codeSelectionAttachments?: UserStoryCodeSelectionAttachment[] | null
  createdAt: string
  fileAttachments?: UserStoryFileAttachment[] | null
  id: number
  quickChatId: number
  updatedAt?: string | null
}

export type QuickChatAgentRun = {
  activities?: UserStoryAgentActivity[] | null
  clineSessionId?: string | null
  completedAt?: string | null
  createdAt: string
  finalResponse?: string | null
  id: number
  kind: UserStoryAgentRunKind
  messageId?: number | null
  quickChatId: number
  sessionSummary?: string | null
  status: UserStoryAgentRunStatus
  updatedAt?: string | null
  usage?: UserStoryAgentUsage | null
}

export type QuickChat = {
  agentActivities?: UserStoryAgentActivity[] | null
  agentFinalResponse?: string | null
  agentLastError?: string | null
  agentLastEvent?: string | null
  agentModelId?: string | null
  agentProviderId?: string | null
  agentSessionSummary?: string | null
  agentStatus?: QuickChatAgentStatus | null
  agentUsage?: UserStoryAgentUsage | null
  clineSessionId?: string | null
  createdAt: string
  id: number
  messages?: QuickChatMessage[]
  preview?: string | null
  agentRuns?: QuickChatAgentRun[]
  projectId: string
  title: string
  updatedAt?: string | null
  workspace?: string | null
}

export type QuickChatDraft = {
  projectId: string
  title: string
  workspace?: string | null
}

export type QuickChatUpdate = Partial<
  Pick<
    QuickChat,
    | "agentActivities"
    | "agentFinalResponse"
    | "agentLastError"
    | "agentLastEvent"
    | "agentModelId"
    | "agentProviderId"
    | "agentSessionSummary"
    | "agentStatus"
    | "agentUsage"
    | "clineSessionId"
    | "title"
    | "workspace"
  >
> & {
  agentActivity?: UserStoryAgentActivity | null
  agentActivityUpdates?: UserStoryAgentActivity[]
}

export type QuickChatMessageDraft = Pick<
  QuickChatMessage,
  "body" | "codeSelectionAttachments" | "fileAttachments"
>

export type QuickChatAgentRunDraft = {
  clineSessionId?: string | null
  kind: UserStoryAgentRunKind
  messageId?: number | null
  status?: UserStoryAgentRunStatus
}

export type QuickChatAgentRunUpdate = Partial<
  Pick<
    QuickChatAgentRun,
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

export type QuickChatActivityDetail = {
  detail: string
}
