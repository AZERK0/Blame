import type { Platform } from "@/context/platform"
import type {
  QuickChat,
  QuickChatAgentRun,
  QuickChatAgentRunFinalization,
  QuickChatAgentRunUpdate,
  QuickChatMessage,
} from "@/components/chat/data/quick-chat-data"
import type { useCloudAuth } from "@/context/cloud-auth"
import type { useModelSelection } from "@/components/model/model-selection"
import type {
  PendingCodeSelectionAttachment,
} from "@/components/backlog/shared/comment-attachment-events"
import type { UserStoryFileAttachment } from "@/components/backlog/data/backlog-data"
import { toast } from "sonner"
import type {
  QueuedQuickChatAgentUpdate,
} from "@/components/chat/data/quick-chat-agent-flow"

export type QuickChatPromptInput = {
  chat: QuickChat
  codeAttachments: PendingCodeSelectionAttachment[]
  executionId: string
  fileAttachments: UserStoryFileAttachment[]
  message: QuickChatMessage
  run: QuickChatAgentRun
  reusedSession: boolean
  sessionId: string
  summary: string
  title: string
}

export async function restoreQuickChatCheckpoint(
  platform: Platform,
  chat: QuickChat,
  sessionId: string | null | undefined,
  checkpointRunCount: number
) {
  if (!platform.agent)
    throw new Error("Desktop agent runtime is not available.")
  if (!sessionId) throw new Error("This message has no Cline session.")
  if (!chat.workspace) throw new Error("This quick chat has no workspace.")
  return platform.agent.sessions.restoreCheckpoint({
    checkpointRunCount,
    cwd: chat.workspace,
    restore: {
      messages: true,
      omitCheckpointMessageFromSession: true,
      workspace: true,
    },
    sessionId,
  })
}

export function quickChatSendValidationError(input: {
  auth: ReturnType<typeof useCloudAuth>
  model: ReturnType<typeof useModelSelection>["currentModel"]
  platform: Platform
  projectPath?: string
}) {
  if (!input.projectPath) return "Open a project first."
  if (input.auth.status !== "authenticated")
    return "Reconnect the selected provider."
  if (!input.model) return "Select a model first."
  if (!input.platform.agent) return "Desktop agent runtime is not available."
}

export function quickChatMessageBody(
  draft: string,
  codeAttachments: PendingCodeSelectionAttachment[],
  fileAttachments: UserStoryFileAttachment[]
) {
  if (draft.trim()) return draft.trim()
  if (codeAttachments.length || fileAttachments.length)
    return "Attached context"
  return ""
}

export function quickChatSendInput(input: QuickChatPromptInput) {
  if (input.reusedSession) {
    return {
      feedback: input.message.body,
      feedbackCodeSelectionAttachments: input.codeAttachments,
      feedbackFileAttachments: input.fileAttachments,
      feedbackOnly: true,
      executionId: input.executionId,
      sessionId: input.sessionId,
      summary: input.summary,
      title: input.title,
    }
  }
  return {
    codeSelectionAttachments: input.codeAttachments,
    executionId: input.executionId,
    fileAttachments: input.fileAttachments,
    sessionId: input.sessionId,
    summary: input.summary,
    title: input.title,
  }
}

export function quickChatDevelopmentSummary(chat: QuickChat, message: string) {
  const context = quickChatResumeContext(chat)
  if (!context.length) return message
  return [message, "", "Existing quick chat context:", ...context].join("\n")
}

function quickChatResumeContext(chat: QuickChat) {
  return [
    chat.agentSessionSummary
      ? `Previous session summary:\n${chat.agentSessionSummary}`
      : "",
    chat.agentFinalResponse
      ? `Last agent response:\n${chat.agentFinalResponse}`
      : "",
    ...quickChatRecentMessages(chat),
    ...quickChatRecentRunSummaries(chat),
    chat.agentLastEvent ? `Last recorded event: ${chat.agentLastEvent}` : "",
    chat.agentLastError ? `Previous agent error: ${chat.agentLastError}` : "",
  ].filter(Boolean)
}

function quickChatRecentMessages(chat: QuickChat) {
  return (chat.messages ?? []).slice(-6).map((item) => {
    const body = item.body.trim()
    return body ? `User message: ${body}` : ""
  })
}

function quickChatRecentRunSummaries(chat: QuickChat) {
  return (chat.agentRuns ?? []).slice(-3).map((run) => {
    const summary = run.sessionSummary?.trim()
    return summary ? `Agent run summary: ${summary}` : ""
  })
}

export function chatWithMessage(chat: QuickChat, message: QuickChatMessage) {
  return {
    ...chat,
    messages: [...(chat.messages ?? []), message],
  }
}

function defaultQuickChatTitle(projectName: string | undefined) {
  return projectName ? `${projectName} quick change` : "Quick change"
}

export function quickChatTitle(
  chat: QuickChat,
  message: string,
  projectName: string | undefined
) {
  if ((chat.messages?.length ?? 0) > 1) return chat.title
  if (chat.title !== defaultQuickChatTitle(projectName)) return chat.title
  return titleFromMessage(message, projectName)
}

export function titleFromMessage(message: string, projectName: string | undefined) {
  const fallback = defaultQuickChatTitle(projectName)
  return shortLabel(message.replace(/[#*_`>[\]()]/g, " ").trim(), 56, fallback)
}

function shortLabel(
  value: string,
  maxLength: number,
  fallback = "Quick change"
) {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (!normalized) return fallback
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}...`
}

export function openProjectPath(
  root: string | undefined,
  path: string,
  openPath: ((path: string) => Promise<string>) | undefined
) {
  if (!openPath) return
  const target = path.startsWith("/") || !root ? path : `${root}/${path}`
  void openPath(target)
}

export function showExpiredAuthenticationToast(message: string) {
  toast.error("Agent authentication expired", {
    description: `${message} Reconnect the selected provider, then send again.`,
    position: "bottom-right",
  })
}

export function showQuickChatError(title: string, description: string) {
  toast.error(title, {
    description,
    position: "bottom-right",
  })
}

export function reportAgentPersistenceError(error: unknown) {
  console.error("Failed to persist quick chat agent update.", error)
}

export function quickChatAgentFinalization(
  update: QueuedQuickChatAgentUpdate
): QuickChatAgentRunFinalization | undefined {
  const status = update.runInput.status
  if (status !== "completed" && status !== "failed" && status !== "cancelled")
    return undefined
  return {
    activities: update.activities,
    agentLastError: update.input.agentLastError,
    agentLastEvent: update.input.agentLastEvent,
    agentStatus: update.input.agentStatus,
    completedAt: update.runInput.completedAt,
    finalResponse:
      update.runInput.finalResponse ?? update.input.agentFinalResponse,
    persistenceEvent: update.runInput.persistenceEvent,
    sessionSummary:
      update.runInput.sessionSummary ?? update.input.agentSessionSummary,
    status,
    usage: update.runInput.usage ?? update.input.agentUsage,
  }
}

export function terminalAgentStatus(status: QuickChatAgentRunUpdate["status"]) {
  return status === "completed" || status === "failed" || status === "cancelled"
}

export function quickChatTerminalPersistenceEvent(
  chat: QuickChat,
  run: QuickChatAgentRun,
  finalization: QuickChatAgentRunFinalization
) {
  return {
    createdAt: finalization.completedAt ?? new Date().toISOString(),
    eventId: crypto.randomUUID(),
    eventType: finalization.status,
    executionId: run.executionId ?? run.id,
    runId: run.id,
    sequenceNumber: (run.lastSequenceNumber ?? 0) + 1,
    sessionId: run.clineSessionId ?? chat.clineSessionId ?? run.id,
  }
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
