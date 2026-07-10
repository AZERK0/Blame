import * as React from "react"

import type {
  BacklogColumnId,
  UserStory,
  UserStoryAgentActivity,
  UserStoryFileAttachment,
} from "@/components/backlog/data/backlog-data"
import { createBacklogApi } from "@/components/backlog/data/backlog-api"
import type { PendingCodeSelectionAttachment } from "@/components/backlog/shared/comment-attachment-events"
import type { UserStoryDrawerMode } from "@/components/backlog/shared/backlog-types"
import {
  MarkdownEditor,
  type PendingFileAttachment,
} from "@/components/backlog/drawer/markdown-editor"
import {
  commentButtonLabel,
  isEditable,
} from "@/components/backlog/drawer/user-story-drawer-helpers"
import {
  AgentConversationComposer,
  AgentConversationTimeline,
  MarkdownMessageActions,
  type AgentConversationUserMessageUndo,
} from "@/components/chat/agent-conversation"
import { agentConversationResponseHeader } from "@/components/chat/agent-conversation-header"
import {
  ModelSelector,
  useModelSelection,
} from "@/components/model/model-selector"
import { useProjects } from "@/context/projects"
import { useCloudAuth } from "@/context/cloud-auth"

const commentComposerBlurMask = {
  maskImage: "linear-gradient(to top, black 0%, black 60%, transparent 100%)",
  WebkitMaskImage:
    "linear-gradient(to top, black 0%, black 60%, transparent 100%)",
} satisfies React.CSSProperties

type UserStoryCommentComposerProps = {
  commentCodeSelectionAttachments: PendingCodeSelectionAttachment[]
  commentFileAttachments: PendingFileAttachment[]
  comment: string
  commentEditorKey: number
  commentRef: React.RefObject<HTMLDivElement | null>
  onCommentChange: (comment: string) => void
  onCommentCodeSelectionAttachmentRemove: (id: string) => void
  onCommentFileAttachmentRemove: (id: string) => void
  onCommentFileAttachmentsAdd: (attachments: UserStoryFileAttachment[]) => void
  onCommentSubmit: () => void
  onFileLinkClick?: (path: string) => void
  status: BacklogColumnId
  userStory?: UserStory
}

type UserStoryFixedSectionProps = UserStoryCommentComposerProps & {
  actions?: React.ReactNode
  mode: UserStoryDrawerMode
}

export function UserStoryContent({
  mode,
  onCommentUndo,
  onSummaryChange,
  onSummaryCodeSelectionAttachmentRemove,
  onSummaryFileAttachmentRemove,
  onSummaryFileAttachmentsAdd,
  onSummaryOptimize,
  onFileLinkClick,
  status,
  summary,
  summaryCodeSelectionAttachments,
  summaryFileAttachments,
  summaryRef,
  userStory,
}: {
  mode: UserStoryDrawerMode
  onCommentUndo?: (target: AgentConversationUserMessageUndo) => Promise<void>
  onSummaryChange?: (summary: string) => void
  onSummaryCodeSelectionAttachmentRemove: (id: string) => void
  onSummaryFileAttachmentRemove: (id: string) => void
  onSummaryFileAttachmentsAdd: (attachments: UserStoryFileAttachment[]) => void
  onSummaryOptimize?: (summary: string) => Promise<string>
  onFileLinkClick?: (path: string) => void
  status: BacklogColumnId
  summary: string
  summaryCodeSelectionAttachments: PendingCodeSelectionAttachment[]
  summaryFileAttachments: PendingFileAttachment[]
  summaryRef: React.RefObject<HTMLDivElement | null>
  userStory?: UserStory
}) {
  const mentionDirectory = useFileMentionDirectory(status, userStory)
  const editable = isEditable(mode, status)
  return (
    <>
      <div className="group/message grid gap-3">
        <MarkdownEditor
          codeSelectionAttachments={summaryCodeSelectionAttachments}
          fileAttachments={summaryFileAttachments}
          mentionDirectory={mentionDirectory}
          ref={summaryRef}
          markdown={summary}
          onCodeSelectionAttachmentRemove={
            onSummaryCodeSelectionAttachmentRemove
          }
          onFileAttachmentRemove={onSummaryFileAttachmentRemove}
          onFileAttachmentsAdd={onSummaryFileAttachmentsAdd}
          onFileLinkClick={onFileLinkClick}
          onMarkdownChange={onSummaryChange}
          onOptimize={onSummaryOptimize}
          readOnly={!editable}
          toolbarEnd={
            editable ? (
              <div className="w-[28rem] max-w-full min-w-0">
                <ModelSelector />
              </div>
            ) : undefined
          }
          placeholder="Describe the user story, expected behavior, and acceptance criteria."
          minHeight="min-h-80"
        />
        {summary.trim() ? (
          <MarkdownMessageActions
            alwaysVisible={summaryActionsAlwaysVisible(userStory)}
            createdAt={userStory?.createdAt}
            markdown={summary}
          />
        ) : null}
      </div>
      <div className="mx-auto w-full max-w-4xl">
        <AgentRunTimeline
          connectSummaryActions={Boolean(summary.trim())}
          userStory={userStory}
          onFileLinkClick={onFileLinkClick}
          onCommentUndo={status === "in-review" ? onCommentUndo : undefined}
        />
      </div>
      <div className={mode === "create" ? "h-8" : "h-16"} />
    </>
  )
}

export function UserStoryFixedSection({
  actions,
  mode,
  ...commentComposerProps
}: UserStoryFixedSectionProps) {
  const commentComposerVisible = mode !== "create"

  if (!commentComposerVisible && !actions) return null

  return (
    <div className={fixedSectionClassName(commentComposerVisible)}>
      <div
        className="pointer-events-none absolute inset-0 bg-background/40 backdrop-blur-xl"
        style={commentComposerBlurMask}
      />
      <div className="relative grid gap-3">
        {commentComposerVisible ? (
          <div className="mx-auto w-full max-w-4xl">
            <UserStoryCommentComposer {...commentComposerProps} />
          </div>
        ) : null}
        {actions ? (
          <div className="flex w-full justify-end">{actions}</div>
        ) : null}
      </div>
    </div>
  )
}

function UserStoryCommentComposer({
  commentCodeSelectionAttachments,
  commentFileAttachments,
  comment,
  commentEditorKey,
  commentRef,
  onCommentChange,
  onCommentCodeSelectionAttachmentRemove,
  onCommentFileAttachmentRemove,
  onCommentFileAttachmentsAdd,
  onCommentSubmit,
  onFileLinkClick,
  status,
  userStory,
}: UserStoryCommentComposerProps) {
  const mentionDirectory = useFileMentionDirectory(status, userStory)

  return (
    <AgentConversationComposer
      codeSelectionAttachments={commentCodeSelectionAttachments}
      disabled={status === "done"}
      editorKey={commentEditorKey}
      editorRef={commentRef}
      fileAttachments={commentFileAttachments}
      mentionDirectory={mentionDirectory}
      message={comment}
      onCodeSelectionAttachmentRemove={onCommentCodeSelectionAttachmentRemove}
      onFileAttachmentRemove={onCommentFileAttachmentRemove}
      onFileAttachmentsAdd={onCommentFileAttachmentsAdd}
      onFileLinkClick={onFileLinkClick}
      onMessageChange={onCommentChange}
      onMessageSubmit={onCommentSubmit}
      placeholder={commentPlaceholder(status)}
      submitLabel={commentButtonLabel(status)}
    />
  )
}

function commentPlaceholder(status: BacklogColumnId) {
  if (status === "done") return "Comments are read-only after merge."
  return "Add a comment"
}

function fixedSectionClassName(commentComposerVisible: boolean) {
  if (commentComposerVisible) {
    return "pointer-events-auto relative -mx-6 px-6 pt-4 pb-6"
  }
  return "pointer-events-auto relative -mx-6 px-6 pt-6 pb-6"
}

function useFileMentionDirectory(
  status: BacklogColumnId,
  userStory: UserStory | undefined
) {
  const projects = useProjects()
  return fileMentionDirectory(status, userStory, projects.activeProject?.path)
}

function AgentRunTimeline({
  connectSummaryActions,
  onCommentUndo,
  onFileLinkClick,
  userStory,
}: {
  connectSummaryActions?: boolean
  onCommentUndo?: (target: AgentConversationUserMessageUndo) => Promise<void>
  onFileLinkClick?: (path: string) => void
  userStory?: UserStory
}) {
  const auth = useCloudAuth()
  const api = React.useMemo(
    () => createBacklogApi(auth.apiConnection),
    [auth.apiConnection]
  )
  const modelSelection = useModelSelection()
  const responseHeader = agentConversationResponseHeader({
    modelId: userStory?.agentModelId,
    providerId: userStory?.agentProviderId,
    providers: modelSelection.allProviders,
  })
  const loadActivityDetail = React.useCallback(
    async (run: { id: string }, activity: UserStoryAgentActivity) => {
      if (!userStory) return activity.detail
      return (
        await api.agentRunActivityDetail(userStory.id, run.id, activity.id)
      ).detail
    },
    [api, userStory]
  )

  return (
    <AgentConversationTimeline
      comments={userStory?.comments ?? []}
      onFileLinkClick={onFileLinkClick}
      onLoadActivityDetail={loadActivityDetail}
      onUserMessageUndo={onCommentUndo}
      responseHeader={responseHeader}
      runs={userStory?.agentRuns ?? []}
      topOffset={connectSummaryActions ? "message-actions" : "default"}
    />
  )
}

function summaryActionsAlwaysVisible(userStory: UserStory | undefined) {
  const runs = userStory?.agentRuns ?? []
  if (!runs.length) return true
  return !runs.some(
    (run) =>
      run.kind !== "initial" ||
      (run.activities ?? []).some((activity) => activity.kind === "message")
  )
}

function fileMentionDirectory(
  status: BacklogColumnId,
  userStory: UserStory | undefined,
  projectPath: string | undefined
) {
  if (status === "backlog" || status === "ready") return projectPath
  if (status === "in-progress" || status === "in-review")
    return userStory?.worktree ?? undefined
}
