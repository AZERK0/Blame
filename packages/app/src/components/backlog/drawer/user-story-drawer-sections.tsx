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
import { useScrollMagnet } from "@/hooks/use-scroll-magnet"

const commentComposerSoftBlurMask = {
  maskImage: "linear-gradient(to top, black 0%, black 60%, transparent 100%)",
  WebkitMaskImage:
    "linear-gradient(to top, black 0%, black 60%, transparent 100%)",
} satisfies React.CSSProperties
const commentComposerStrongBlurMask = {
  maskImage: "linear-gradient(to top, black 0%, transparent 72%)",
  WebkitMaskImage: "linear-gradient(to top, black 0%, transparent 72%)",
} satisfies React.CSSProperties

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
  const projects = useProjects()
  const mentionDirectory = fileMentionDirectory(
    status,
    userStory,
    projects.activeProject?.path
  )
  const editable = isEditable(mode, status)
  const contentEndRef = React.useRef<HTMLDivElement>(null)
  const timelineScrollKey = userStoryTimelineScrollKey(userStory)

  useScrollMagnet(contentEndRef, timelineScrollKey, userStory?.id ?? mode)

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
      <AgentRunTimeline
      userStory={userStory}
      onFileLinkClick={onFileLinkClick}
      onCommentUndo={status === "in-review" ? onCommentUndo : undefined}
    />
      {mode !== "create" && (
        <div className="sticky bottom-0 z-20 -mx-6 px-6 pt-10 pb-6">
          <div
            className="absolute inset-0 backdrop-blur-sm"
            style={commentComposerSoftBlurMask}
          />
          <div
            className="absolute inset-0 backdrop-blur-xl"
            style={commentComposerStrongBlurMask}
          />
          <div className="relative">
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
          </div>
        </div>
      )}
      <div ref={contentEndRef} />
    </>
  )
}

function AgentRunTimeline({
  onCommentUndo,
  onFileLinkClick,
  userStory,
}: {
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
    />
  )
}

function userStoryTimelineScrollKey(userStory: UserStory | undefined) {
  const run = userStory?.agentRuns?.at(-1)
  const activities = run?.activities ?? []
  const activity = activities.at(-1)

  return [
    userStory?.id ?? "new",
    userStory?.agentLastEvent?.length ?? 0,
    userStory?.comments?.length ?? 0,
    userStory?.updatedAt ?? "",
    userStory?.agentStatus ?? "",
    run?.id ?? "",
    run?.status ?? "",
    run?.updatedAt ?? "",
    run?.finalResponse?.length ?? 0,
    activities.length,
    activity?.id ?? "",
    activity?.detail.length ?? 0,
    activity?.updatedAt ?? "",
  ].join(":")
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
