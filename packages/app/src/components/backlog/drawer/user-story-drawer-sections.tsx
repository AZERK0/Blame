import * as React from "react"
import {
  BotIcon,
  CheckCircle2Icon,
  FileTextIcon,
  GitBranchIcon,
  ListChecksIcon,
  MessageSquareIcon,
  PencilIcon,
  XCircleIcon,
} from "lucide-react"

import type {
  BacklogColumnId,
  UserStory,
} from "@/components/backlog/data/backlog-data"
import type { PendingCodeSelectionAttachment } from "@/components/backlog/shared/comment-attachment-events"
import type { UserStoryDrawerMode } from "@/components/backlog/shared/backlog-types"
import { MarkdownEditor } from "@/components/backlog/drawer/markdown-editor"
import {
  activityItems,
  commentButtonLabel,
  isEditable,
} from "@/components/backlog/drawer/user-story-drawer-helpers"
import { useProjects } from "@/context/projects"
import { Button } from "@/components/ui/button"

export function UserStoryContent({
  commentCodeSelectionAttachments,
  commentRef,
  mode,
  onSummaryChange,
  status,
  summaryCodeSelectionAttachments,
  userStory,
}: {
  commentCodeSelectionAttachments: PendingCodeSelectionAttachment[]
  commentRef: React.RefObject<HTMLDivElement | null>
  mode: UserStoryDrawerMode
  onSummaryChange?: (summary: string) => void
  status: BacklogColumnId
  summaryCodeSelectionAttachments: PendingCodeSelectionAttachment[]
  userStory?: UserStory
}) {
  const projects = useProjects()
  const mentionDirectory = fileMentionDirectory(
    status,
    userStory,
    projects.activeProject?.path
  )

  return (
    <>
      <MarkdownEditor
        codeSelectionAttachments={summaryCodeSelectionAttachments}
        mentionDirectory={mentionDirectory}
        markdown={userStory?.summary ?? ""}
        onMarkdownChange={onSummaryChange}
        readOnly={!isEditable(mode, status)}
        placeholder="Describe the user story, expected behavior, and acceptance criteria."
        minHeight="min-h-70"
      />
      <ActivitySection status={status} userStory={userStory} />
      <CommentsSection
        codeSelectionAttachments={commentCodeSelectionAttachments}
        commentRef={commentRef}
        mentionDirectory={mentionDirectory}
        status={status}
        userStory={userStory}
      />
    </>
  )
}

function ActivitySection({
  status,
  userStory,
}: {
  status: BacklogColumnId
  userStory?: UserStory
}) {
  const items = activityItems(status, userStory)

  return (
    <div className="-mt-6 grid gap-0">
      <div className="relative grid gap-4 pt-6">
        <span className="absolute top-0 bottom-0 left-4 w-px bg-muted-foreground/35" />
        {items.map((item) => {
          const Icon = activityIcon(item)

          return (
            <div
              key={item}
              className="relative grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-1 text-sm"
            >
              <span className="relative z-10 flex size-8 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm">
                <Icon className="size-4" />
              </span>
              <p className="text-muted-foreground">{item}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function activityIcon(item: string) {
  if (item.includes("worktree")) return GitBranchIcon
  if (item.includes("submitted")) return BotIcon
  if (item.includes("Approved")) return CheckCircle2Icon
  if (item.includes("rejected") || item.includes("cancelled")) return XCircleIcon
  if (item.includes("updated")) return PencilIcon
  if (item.includes("Moved")) return ListChecksIcon
  return FileTextIcon
}

function CommentsSection({
  codeSelectionAttachments,
  commentRef,
  mentionDirectory,
  status,
  userStory,
}: {
  codeSelectionAttachments: PendingCodeSelectionAttachment[]
  commentRef: React.RefObject<HTMLDivElement | null>
  mentionDirectory?: string
  status: BacklogColumnId
  userStory?: UserStory
}) {
  const disabled = status === "done"
  const commentLabel = commentButtonLabel(status, userStory)

  return (
    <section className="grid gap-3">
      <div className="flex items-center gap-4 font-medium text-xl">
        <span className="flex size-11 items-center justify-center rounded-full border bg-muted text-muted-foreground shadow-sm">
          <MessageSquareIcon className="size-5" />
        </span>
        Add a comment
      </div>
      <MarkdownEditor
        codeSelectionAttachments={codeSelectionAttachments}
        mentionDirectory={mentionDirectory}
        ref={commentRef}
        markdown=""
        readOnly={disabled}
        placeholder={
          disabled ? "Comments are read-only after merge." : "Add a comment"
        }
        minHeight="min-h-24"
      />
      <div className="flex justify-end">
        <Button
          className="border-blue-500/40 bg-blue-500/10 text-blue-700 hover:bg-blue-500/20 dark:text-blue-300"
          disabled={disabled}
          variant="outline"
        >
          <MessageSquareIcon />
          {commentLabel}
        </Button>
      </div>
    </section>
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
