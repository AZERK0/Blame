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
} from "@/components/chat/agent-conversation"
import { agentConversationResponseHeader } from "@/components/chat/agent-conversation-header"
import {
  ModelSelector,
  useModelSelection,
} from "@/components/model/model-selector"
import { useProjects } from "@/context/projects"
import { useCloudAuth } from "@/context/cloud-auth"

export function UserStoryContent({
  commentCodeSelectionAttachments,
  commentFileAttachments,
  comment,
  commentEditorKey,
  commentRef,
  mode,
  onCommentChange,
  onCommentCodeSelectionAttachmentRemove,
  onCommentFileAttachmentRemove,
  onCommentFileAttachmentsAdd,
  onCommentSubmit,
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
  commentCodeSelectionAttachments: PendingCodeSelectionAttachment[]
  commentFileAttachments: PendingFileAttachment[]
  comment: string
  commentEditorKey: number
  commentRef: React.RefObject<HTMLDivElement | null>
  mode: UserStoryDrawerMode
  onCommentChange: (comment: string) => void
  onCommentCodeSelectionAttachmentRemove: (id: string) => void
  onCommentFileAttachmentRemove: (id: string) => void
  onCommentFileAttachmentsAdd: (attachments: UserStoryFileAttachment[]) => void
  onCommentSubmit: () => void
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
  const projects = useProjects()
  const mentionDirectory = fileMentionDirectory(
    status,
    userStory,
    projects.activeProject?.path
  )
  const editable = isEditable(mode, status)

  return (
    <>
      <MarkdownEditor
        codeSelectionAttachments={summaryCodeSelectionAttachments}
        fileAttachments={summaryFileAttachments}
        mentionDirectory={mentionDirectory}
        ref={summaryRef}
        markdown={summary}
        onCodeSelectionAttachmentRemove={onSummaryCodeSelectionAttachmentRemove}
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
      <AgentRunTimeline
        userStory={userStory}
        onFileLinkClick={onFileLinkClick}
      />
      {mode !== "create" && (
        <AgentConversationComposer
          codeSelectionAttachments={commentCodeSelectionAttachments}
          disabled={status === "done"}
          editorKey={commentEditorKey}
          editorRef={commentRef}
          fileAttachments={commentFileAttachments}
          mentionDirectory={mentionDirectory}
          message={comment}
          onCodeSelectionAttachmentRemove={
            onCommentCodeSelectionAttachmentRemove
          }
          onFileAttachmentRemove={onCommentFileAttachmentRemove}
          onFileAttachmentsAdd={onCommentFileAttachmentsAdd}
          onFileLinkClick={onFileLinkClick}
          onMessageChange={onCommentChange}
          onMessageSubmit={onCommentSubmit}
          placeholder={
            status === "done"
              ? "Comments are read-only after merge."
              : "Add a comment"
          }
          submitLabel={commentButtonLabel(status)}
          title="Add a comment"
        />
      )}
    </>
  )
}

function AgentRunTimeline({
  onFileLinkClick,
  userStory,
}: {
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
    async (run: { id: number }, activity: UserStoryAgentActivity) => {
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
      responseHeader={responseHeader}
      runs={userStory?.agentRuns ?? []}
    />
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
