import * as React from "react"
import { Collapsible } from "radix-ui"
import {
  BotIcon,
  BrainCircuitIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  FileTextIcon,
  GitBranchIcon,
  ListChecksIcon,
  MessageSquareIcon,
  PencilIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react"

import type {
  BacklogColumnId,
  UserStory,
  UserStoryAgentActivity,
} from "@/components/backlog/data/backlog-data"
import type { PendingCodeSelectionAttachment } from "@/components/backlog/shared/comment-attachment-events"
import type { UserStoryDrawerMode } from "@/components/backlog/shared/backlog-types"
import {
  MarkdownEditor,
  type PendingFileAttachment,
} from "@/components/backlog/drawer/markdown-editor"
import {
  activityItems,
  commentButtonLabel,
  isEditable,
} from "@/components/backlog/drawer/user-story-drawer-helpers"
import { useProjects } from "@/context/projects"
import { Button } from "@/components/ui/button"

export function UserStoryContent({
  commentCodeSelectionAttachments,
  commentFileAttachments,
  commentRef,
  mode,
  onSummaryChange,
  status,
  summaryCodeSelectionAttachments,
  userStory,
}: {
  commentCodeSelectionAttachments: PendingCodeSelectionAttachment[]
  commentFileAttachments?: PendingFileAttachment[]
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
      <AgentFinalResponseSection userStory={userStory} />
      <CommentsSection
        codeSelectionAttachments={commentCodeSelectionAttachments}
        fileAttachments={commentFileAttachments}
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
  const agentActivities = userStory?.agentActivities ?? []

  return (
    <div className="-mt-6 grid gap-0">
      <div className="relative grid gap-4 pt-6">
        <span className="absolute top-0 bottom-0 left-4 w-px bg-muted-foreground/35" />
        {items.map((item) => {
          const Icon = lifeActivityIcon(item)

          return (
            <div
              key={`life-${item}`}
              className="relative grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-1 text-sm"
            >
              <span className="relative z-10 flex size-8 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm">
                <Icon className="size-4" />
              </span>
              <p className="text-muted-foreground">{item}</p>
            </div>
          )
        })}
        {agentActivities.map((activity) => (
          <AgentActivityItem key={activity.id} activity={activity} />
        ))}
      </div>
    </div>
  )
}

function AgentActivityItem({
  activity,
}: {
  activity: UserStoryAgentActivity
}) {
  const Icon = agentActivityIcon(activity)

  return (
    <Collapsible.Root>
      <div className="relative grid grid-cols-[2.5rem_minmax(0,1fr)] gap-1 text-sm">
        <span className="relative z-10 flex size-8 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <Collapsible.Trigger
            className="group flex w-full min-w-0 items-center justify-between gap-3 text-left text-muted-foreground"
            type="button"
          >
            <span className="truncate">{activity.title}</span>
            <ChevronDownIcon className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
          </Collapsible.Trigger>
          <Collapsible.Content>
            <pre className="mt-2 max-h-72 overflow-auto rounded-md border bg-muted/35 p-3 text-xs whitespace-pre-wrap text-muted-foreground">
              {activity.detail}
            </pre>
          </Collapsible.Content>
        </div>
      </div>
    </Collapsible.Root>
  )
}

function AgentFinalResponseSection({ userStory }: { userStory?: UserStory }) {
  const response = userStory?.agentFinalResponse?.trim()
  if (!response) return null

  return (
    <section className="grid gap-3">
      <div className="flex items-center gap-4 text-xl font-medium">
        <span className="flex size-11 items-center justify-center rounded-full border bg-muted text-muted-foreground shadow-sm">
          <BotIcon className="size-5" />
        </span>
        Agent response
      </div>
      <MarkdownEditor
        markdown={response}
        readOnly
        placeholder=""
        minHeight="min-h-24"
      />
    </section>
  )
}

function lifeActivityIcon(item: string) {
  if (item.includes("worktree")) return GitBranchIcon
  if (item.includes("submitted")) return BotIcon
  if (item.includes("Approved")) return CheckCircle2Icon
  if (item.includes("rejected") || item.includes("cancelled"))
    return XCircleIcon
  if (item.includes("updated")) return PencilIcon
  if (item.includes("Moved")) return ListChecksIcon
  return FileTextIcon
}

function agentActivityIcon(activity: UserStoryAgentActivity) {
  if (activity.kind === "reasoning") return BrainCircuitIcon
  if (activity.kind === "tool") return WrenchIcon
  if (activity.kind === "approval") return CheckCircle2Icon
  return BotIcon
}

function CommentsSection({
  codeSelectionAttachments,
  fileAttachments,
  commentRef,
  mentionDirectory,
  status,
  userStory,
}: {
  codeSelectionAttachments: PendingCodeSelectionAttachment[]
  fileAttachments?: PendingFileAttachment[]
  commentRef: React.RefObject<HTMLDivElement | null>
  mentionDirectory?: string
  status: BacklogColumnId
  userStory?: UserStory
}) {
  const disabled = status === "done"
  const commentLabel = commentButtonLabel(status, userStory)

  return (
    <section className="grid gap-3">
      <div className="flex items-center gap-4 text-xl font-medium">
        <span className="flex size-11 items-center justify-center rounded-full border bg-muted text-muted-foreground shadow-sm">
          <MessageSquareIcon className="size-5" />
        </span>
        Add a comment
      </div>
      <MarkdownEditor
        codeSelectionAttachments={codeSelectionAttachments}
        fileAttachments={fileAttachments}
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
