import * as React from "react"
import {
  BotIcon,
  BrainCircuitIcon,
  CheckCircle2Icon,
  ClipboardCheckIcon,
  Code2Icon,
  FileSearchIcon,
  ListChecksIcon,
  MessageSquareIcon,
  PencilIcon,
  SearchIcon,
  TerminalIcon,
} from "lucide-react"

import type {
  BacklogColumnId,
  UserStory,
  UserStoryAgentActivity,
  UserStoryAgentRun,
  UserStoryComment,
} from "@/components/backlog/data/backlog-data"
import { createBacklogApi } from "@/components/backlog/data/backlog-api"
import type { PendingCodeSelectionAttachment } from "@/components/backlog/shared/comment-attachment-events"
import type { UserStoryDrawerMode } from "@/components/backlog/shared/backlog-types"
import {
  MarkdownEditor,
  type PendingFileAttachment,
} from "@/components/backlog/drawer/markdown-editor"
import { pendingFileAttachments } from "@/components/backlog/drawer/user-story-attachment-files"
import type { UserStoryFileAttachment } from "@/components/backlog/data/backlog-data"
import {
  commentButtonLabel,
  isEditable,
} from "@/components/backlog/drawer/user-story-drawer-helpers"
import { useProjects } from "@/context/projects"
import { useCloudAuth } from "@/context/cloud-auth"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"

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
        readOnly={!isEditable(mode, status)}
        placeholder="Describe the user story, expected behavior, and acceptance criteria."
        minHeight="min-h-70"
      />
      <AgentRunTimeline
        userStory={userStory}
        onFileLinkClick={onFileLinkClick}
      />
      <CommentsSection
        codeSelectionAttachments={commentCodeSelectionAttachments}
        fileAttachments={commentFileAttachments}
        comment={comment}
        editorKey={commentEditorKey}
        commentRef={commentRef}
        mentionDirectory={mentionDirectory}
        onCommentChange={onCommentChange}
        onCodeSelectionAttachmentRemove={onCommentCodeSelectionAttachmentRemove}
        onFileAttachmentRemove={onCommentFileAttachmentRemove}
        onFileAttachmentsAdd={onCommentFileAttachmentsAdd}
        onCommentSubmit={onCommentSubmit}
        onFileLinkClick={onFileLinkClick}
        status={status}
      />
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
  const runs = userStory?.agentRuns ?? []
  const commentsById = React.useMemo(
    () =>
      new Map(
        (userStory?.comments ?? []).map((comment) => [comment.id, comment])
      ),
    [userStory?.comments]
  )
  const loadActivityDetail = React.useCallback(
    async (run: UserStoryAgentRun, activity: UserStoryAgentActivity) => {
      if (!userStory) return activity.detail
      return (
        await api.agentRunActivityDetail(userStory.id, run.id, activity.id)
      ).detail
    },
    [api, userStory]
  )

  if (runs.length === 0) return null

  return (
    <div className="-mt-6 grid gap-0">
      <div className="relative grid gap-4 pt-6">
        <span className="absolute top-0 bottom-0 left-4 w-px bg-muted-foreground/35" />
        <Accordion type="multiple" className="contents">
          {runs.map((run) => (
            <React.Fragment key={run.id}>
              <RunCommentItem
                comment={runComment(run, commentsById)}
                run={run}
                onFileLinkClick={onFileLinkClick}
              />
              {(run.activities ?? []).map((activity) => (
                <AgentActivityItem
                  key={`${run.id}-${activity.id}`}
                  activity={activity}
                  onLoadDetail={(item) => loadActivityDetail(run, item)}
                  value={`${run.id}-${activity.id}`}
                />
              ))}
              <AgentResponseItem
                response={run.finalResponse}
                onFileLinkClick={onFileLinkClick}
              />
            </React.Fragment>
          ))}
        </Accordion>
      </div>
    </div>
  )
}

function RunCommentItem({
  comment,
  onFileLinkClick,
  run,
}: {
  comment?: UserStoryComment
  onFileLinkClick?: (path: string) => void
  run: UserStoryAgentRun
}) {
  if (run.kind === "initial") return null
  if (!comment) return null

  return (
    <div className="relative grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-1">
      <span className="relative z-10 flex size-8 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm">
        <MessageSquareIcon className="size-4" />
      </span>
      <div className="grid min-w-0 gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-xl font-medium">User comment</h3>
          <p className="text-xs font-medium text-muted-foreground">
            {comment.author} · {commentDateLabel(comment.createdAt)}
          </p>
        </div>
        <MarkdownEditor
          codeSelectionAttachments={comment.codeSelectionAttachments ?? []}
          fileAttachments={pendingFileAttachments(
            comment.fileAttachments ?? []
          )}
          markdown={comment.body}
          readOnly
          onFileLinkClick={onFileLinkClick}
          placeholder=""
          minHeight="min-h-24"
        />
      </div>
    </div>
  )
}

function AgentActivityItem({
  activity,
  onLoadDetail,
  value,
}: {
  activity: UserStoryAgentActivity
  onLoadDetail: (activity: UserStoryAgentActivity) => Promise<string>
  value: string
}) {
  const [fullDetail, setFullDetail] = React.useState<string>()
  const [loading, setLoading] = React.useState(false)
  const details = activityDetails(
    fullDetail ? { ...activity, detail: fullDetail } : activity
  )
  const loadDetail = React.useCallback(async () => {
    setLoading(true)
    try {
      setFullDetail(await onLoadDetail(activity))
    } finally {
      setLoading(false)
    }
  }, [activity, onLoadDetail])

  return (
    <AccordionItem value={value} className="border-b-0!">
      <div className="relative grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-1 text-sm">
        <span className="relative z-10 flex size-8 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm">
          <ActivityToolIcon activity={activity} toolName={details.toolName} />
        </span>
        <div className="min-w-0">
          <AccordionTrigger className="min-h-8 items-center py-0 text-muted-foreground hover:no-underline">
            <span className="truncate">{activityTitle(activity, details)}</span>
          </AccordionTrigger>
          <AccordionContent className="pt-2 pb-0">
            <ActivityDetails
              activity={activity}
              details={details}
              loading={loading}
              onLoadDetail={loadDetail}
            />
          </AccordionContent>
        </div>
      </div>
    </AccordionItem>
  )
}

function ActivityDetails({
  activity,
  details,
  loading,
  onLoadDetail,
}: {
  activity: UserStoryAgentActivity
  details: ActivityDetail
  loading: boolean
  onLoadDetail: () => void
}) {
  const sections = activityDetailSections(details)
  const loadButton = activity.detailArtifact ? (
    <Button
      className="justify-self-start"
      disabled={loading}
      onClick={onLoadDetail}
      size="sm"
      type="button"
      variant="outline"
    >
      {loading ? "Loading detail" : "Load full detail"}
    </Button>
  ) : null

  if (sections.length === 0) {
    return (
      <div className="grid gap-2">
        <p className="rounded-md border bg-muted/25 px-3 py-2 text-sm text-muted-foreground">
          {details.fallback}
        </p>
        {loadButton}
      </div>
    )
  }

  return (
    <div className="grid gap-2">
      <div className="grid gap-2 rounded-md border bg-muted/20 p-2">
        {sections.map((section) => (
          <div
            key={section.label}
            className="grid gap-1 rounded bg-background/60 p-3"
          >
            <div className="flex items-center justify-between gap-3 text-xs font-medium text-muted-foreground">
              <span>{section.label}</span>
              {section.meta ? <span>{section.meta}</span> : null}
            </div>
            <div className="font-mono text-xs leading-relaxed break-words text-foreground/80">
              {section.value}
            </div>
          </div>
        ))}
      </div>
      {loadButton}
    </div>
  )
}

function AgentResponseItem({
  onFileLinkClick,
  response,
}: {
  onFileLinkClick?: (path: string) => void
  response?: string | null
}) {
  const markdown = response?.trim()
  if (!markdown) return null

  return (
    <div className="relative grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-1">
      <span className="relative z-10 flex size-8 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm">
        <BotIcon className="size-4" />
      </span>
      <div className="grid min-w-0 gap-3">
        <h3 className="text-xl font-medium">Agent response</h3>
        <MarkdownEditor
          markdown={markdown}
          readOnly
          onFileLinkClick={onFileLinkClick}
          placeholder=""
          minHeight="min-h-24"
        />
      </div>
    </div>
  )
}

function ActivityToolIcon({
  activity,
  toolName,
}: {
  activity: UserStoryAgentActivity
  toolName: string | undefined
}) {
  if (activity.kind === "reasoning")
    return <BrainCircuitIcon className="size-4" />
  if (activity.kind === "approval")
    return <CheckCircle2Icon className="size-4" />
  if (activity.kind !== "tool") return <BotIcon className="size-4" />
  if (toolName === "run_commands") return <TerminalIcon className="size-4" />
  if (toolName === "search_codebase") return <SearchIcon className="size-4" />
  if (toolName === "read_files") return <FileSearchIcon className="size-4" />
  if (toolName === "apply_patch") return <Code2Icon className="size-4" />
  if (toolName === "write_file") return <PencilIcon className="size-4" />
  if (toolName === "list_files") return <ListChecksIcon className="size-4" />
  return <ClipboardCheckIcon className="size-4" />
}

type ActivityDetail = {
  durationMs?: number
  fallback: string
  input?: unknown
  output?: unknown
  raw?: unknown
  toolName?: string
}

type ActivityDetailSection = {
  label: string
  meta?: string
  value: string
}

function activityDetails(activity: UserStoryAgentActivity): ActivityDetail {
  const parsed = parseDetail(activity.detail)
  const raw = recordValue(parsed?.raw)
  const parsedToolName = stringValue(parsed?.toolName)
  const rawToolName = stringValue(raw.toolName)
  const rawToolCall = recordValue(raw.toolCall)
  const toolName =
    parsedToolName ??
    rawToolName ??
    stringValue(rawToolCall.name) ??
    toolNameFromTitle(activity.title)

  return {
    durationMs: numberValue(parsed?.durationMs),
    fallback: activity.detail,
    input: parsed?.input,
    output: parsed?.output,
    raw: parsed?.raw,
    toolName,
  }
}

function activityTitle(
  activity: UserStoryAgentActivity,
  details: ActivityDetail
) {
  if (activity.kind !== "tool") return activity.title
  return toolLabel(details.toolName ?? activity.title)
}

function activityDetailSections(
  details: ActivityDetail
): ActivityDetailSection[] {
  const sections: ActivityDetailSection[] = []
  const input = summarizeValue(details.input)
  const output = summarizeOutput(details.output)
  if (input) sections.push({ label: "Input", value: input })
  if (output) {
    sections.push({
      label: "Output",
      meta: details.durationMs ? `${details.durationMs} ms` : undefined,
      value: output,
    })
  }
  return sections
}

function summarizeOutput(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((entry, index) => outputEntryLabel(entry, index))
      .join("\n\n")
  }
  return summarizeValue(value)
}

function outputEntryLabel(value: unknown, index: number) {
  const entry = recordValue(value)
  const title = stringValue(entry.query) ?? `Result ${index + 1}`
  const result = stringValue(entry.result) ?? summarizeValue(entry)
  const status = entry.success === false ? "failed" : "ok"
  return `${title}\n${status}\n${truncateMiddle(result, 1200)}`
}

function summarizeValue(value: unknown) {
  if (value === undefined || value === null) return ""
  if (typeof value === "string") return truncateMiddle(value, 1200)
  return truncateMiddle(JSON.stringify(value, undefined, 2), 1200)
}

function parseDetail(value: string) {
  try {
    const parsed = JSON.parse(value)
    return recordValue(parsed)
  } catch {
    return undefined
  }
}

function toolLabel(toolName: string) {
  const normalized = toolNameFromTitle(toolName) ?? toolName
  if (normalized === "run_commands") return "Terminal command"
  if (normalized === "read_files") return "File inspection"
  if (normalized === "search_codebase") return "Code search"
  if (normalized === "apply_patch") return "Code edit"
  if (normalized === "write_file") return "File write"
  if (normalized === "list_files") return "File listing"
  return humanizeToolName(normalized)
}

function toolNameFromTitle(value: string) {
  return value.match(
    /(?:Tool (?:finished|started|updated|used): )?([\w-]+)$/
  )?.[1]
}

function humanizeToolName(value: string) {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function truncateMiddle(value: string | undefined, maxLength: number) {
  if (!value) return ""
  if (value.length <= maxLength) return value
  const edgeLength = Math.floor((maxLength - 20) / 2)
  return `${value.slice(0, edgeLength)}\n...\n${value.slice(-edgeLength)}`
}

function recordValue(value: unknown) {
  if (value && typeof value === "object")
    return value as Record<string, unknown>
  return {}
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : undefined
}

function CommentsSection({
  codeSelectionAttachments,
  fileAttachments,
  comment,
  editorKey,
  commentRef,
  mentionDirectory,
  onCodeSelectionAttachmentRemove,
  onFileAttachmentRemove,
  onFileAttachmentsAdd,
  onCommentChange,
  onCommentSubmit,
  onFileLinkClick,
  status,
}: {
  codeSelectionAttachments: PendingCodeSelectionAttachment[]
  fileAttachments: PendingFileAttachment[]
  comment: string
  editorKey: number
  commentRef: React.RefObject<HTMLDivElement | null>
  mentionDirectory?: string
  onCodeSelectionAttachmentRemove: (id: string) => void
  onFileAttachmentRemove: (id: string) => void
  onFileAttachmentsAdd: (attachments: UserStoryFileAttachment[]) => void
  onCommentChange: (comment: string) => void
  onCommentSubmit: () => void
  onFileLinkClick?: (path: string) => void
  status: BacklogColumnId
}) {
  const disabled = status === "done"
  const commentLabel = commentButtonLabel(status)
  const hasCommentBody = Boolean(
    comment.trim() || codeSelectionAttachments.length || fileAttachments.length
  )

  return (
    <section className="grid gap-3">
      <div className="flex items-center gap-4 text-xl font-medium">
        <span className="flex size-11 items-center justify-center rounded-full border bg-muted text-muted-foreground shadow-sm">
          <MessageSquareIcon className="size-5" />
        </span>
        Add a comment
      </div>
      <MarkdownEditor
        key={editorKey}
        codeSelectionAttachments={codeSelectionAttachments}
        fileAttachments={fileAttachments}
        mentionDirectory={mentionDirectory}
        ref={commentRef}
        markdown={comment}
        onCodeSelectionAttachmentRemove={onCodeSelectionAttachmentRemove}
        onFileAttachmentRemove={onFileAttachmentRemove}
        onFileAttachmentsAdd={onFileAttachmentsAdd}
        onMarkdownChange={onCommentChange}
        onFileLinkClick={onFileLinkClick}
        readOnly={disabled}
        placeholder={
          disabled ? "Comments are read-only after merge." : "Add a comment"
        }
        minHeight="min-h-24"
      />
      <div className="flex justify-end">
        <Button
          className="border-blue-500/40 bg-blue-500/10 text-blue-700 hover:bg-blue-500/20 dark:text-blue-300"
          disabled={disabled || !hasCommentBody}
          variant="outline"
          onClick={onCommentSubmit}
        >
          <MessageSquareIcon />
          {commentLabel}
        </Button>
      </div>
    </section>
  )
}

function commentDateLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Just now"
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

function runComment(
  run: UserStoryAgentRun,
  commentsById: Map<number, UserStoryComment>
) {
  return run.commentId ? commentsById.get(run.commentId) : undefined
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
