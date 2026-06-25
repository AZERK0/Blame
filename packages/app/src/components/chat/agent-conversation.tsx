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
  UserStoryAgentActivity,
  UserStoryAgentRun,
  UserStoryComment,
  UserStoryFileAttachment,
} from "@/components/backlog/data/backlog-data"
import type { AgentConversationResponseHeader } from "@/components/chat/agent-conversation-header"
import type { PendingCodeSelectionAttachment } from "@/components/backlog/shared/comment-attachment-events"
import {
  MarkdownEditor,
  type PendingFileAttachment,
} from "@/components/backlog/drawer/markdown-editor"
import { pendingFileAttachments } from "@/components/backlog/drawer/user-story-attachment-files"
import {
  userStoryActivityTree,
  type UserStoryActivityNode,
} from "@/components/backlog/drawer/user-story-activity-tree"
import { ProviderMark } from "@/components/model/model-selector"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"

export function AgentConversationTimeline({
  comments,
  onFileLinkClick,
  onLoadActivityDetail,
  responseHeader,
  runs,
}: {
  comments: UserStoryComment[]
  onFileLinkClick?: (path: string) => void
  onLoadActivityDetail?: (
    run: UserStoryAgentRun,
    activity: UserStoryAgentActivity
  ) => Promise<string>
  responseHeader: AgentConversationResponseHeader
  runs: UserStoryAgentRun[]
}) {
  const commentsById = React.useMemo(
    () => new Map(comments.map((comment) => [comment.id, comment])),
    [comments]
  )
  const loadActivityDetail = React.useCallback(
    (run: UserStoryAgentRun, activity: UserStoryAgentActivity) =>
      onLoadActivityDetail?.(run, activity) ?? Promise.resolve(activity.detail),
    [onLoadActivityDetail]
  )

  if (runs.length === 0) return null

  return (
    <div className="-mt-6 grid gap-0">
      <div className="relative grid gap-4 pt-6">
        <span className="absolute top-0 bottom-0 left-4 w-px bg-muted-foreground/35" />
        <Accordion type="multiple" className="contents">
          {runs.map((run) => {
            const activities = agentDisplayActivities(
              run.activities ?? [],
              run.finalResponse
            )
            const runningToolActivityId = currentRunningToolActivityId(
              run.status,
              activities
            )
            return (
              <React.Fragment key={run.id}>
                <RunCommentItem
                  comment={runComment(run, commentsById)}
                  run={run}
                  onFileLinkClick={onFileLinkClick}
                />
                {userStoryActivityTree(activities).map((node) => (
                  <AgentActivityItem
                    key={`${run.id}-${node.id}`}
                    node={node}
                    onFileLinkClick={onFileLinkClick}
                    onLoadDetail={(item) => loadActivityDetail(run, item)}
                    responseHeader={responseHeader}
                    runActive={run.status === "running"}
                    runningToolActivityId={runningToolActivityId}
                    value={`${run.id}-${node.id}`}
                  />
                ))}
                <AgentResponseItem
                  activities={activities}
                  response={run.finalResponse}
                  responseHeader={responseHeader}
                  onFileLinkClick={onFileLinkClick}
                />
              </React.Fragment>
            )
          })}
        </Accordion>
      </div>
    </div>
  )
}

export function AgentConversationComposer({
  codeSelectionAttachments,
  disabled,
  editorKey,
  editorRef,
  fileAttachments,
  mentionDirectory,
  message,
  onCodeSelectionAttachmentRemove,
  onFileAttachmentRemove,
  onFileAttachmentsAdd,
  onFileLinkClick,
  onMessageChange,
  onMessageSubmit,
  placeholder,
  submitLabel,
  title,
  toolbarEnd,
}: {
  codeSelectionAttachments: PendingCodeSelectionAttachment[]
  disabled?: boolean
  editorKey: number
  editorRef: React.RefObject<HTMLDivElement | null>
  fileAttachments: PendingFileAttachment[]
  mentionDirectory?: string
  message: string
  onCodeSelectionAttachmentRemove: (id: string) => void
  onFileAttachmentRemove: (id: string) => void
  onFileAttachmentsAdd: (attachments: UserStoryFileAttachment[]) => void
  onFileLinkClick?: (path: string) => void
  onMessageChange: (message: string) => void
  onMessageSubmit: () => void
  placeholder: string
  submitLabel: string
  title: string
  toolbarEnd?: React.ReactNode
}) {
  const hasMessageBody = Boolean(
    message.trim() || codeSelectionAttachments.length || fileAttachments.length
  )

  return (
    <section className="grid gap-3">
      <div className="flex items-center gap-4 text-xl font-medium">
        <span className="flex size-11 items-center justify-center rounded-full border bg-muted text-muted-foreground shadow-sm">
          <MessageSquareIcon className="size-5" />
        </span>
        {title}
      </div>
      <MarkdownEditor
        key={editorKey}
        codeSelectionAttachments={codeSelectionAttachments}
        fileAttachments={fileAttachments}
        mentionDirectory={mentionDirectory}
        ref={editorRef}
        markdown={message}
        onCodeSelectionAttachmentRemove={onCodeSelectionAttachmentRemove}
        onFileAttachmentRemove={onFileAttachmentRemove}
        onFileAttachmentsAdd={onFileAttachmentsAdd}
        onMarkdownChange={onMessageChange}
        onFileLinkClick={onFileLinkClick}
        readOnly={disabled}
        placeholder={placeholder}
        minHeight="min-h-24"
        toolbarEnd={toolbarEnd}
      />
      <div className="flex justify-end">
        <Button
          className="border-blue-500/40 bg-blue-500/10 text-blue-700 hover:bg-blue-500/20 dark:text-blue-300"
          disabled={disabled || !hasMessageBody}
          variant="outline"
          onClick={onMessageSubmit}
        >
          <MessageSquareIcon />
          {submitLabel}
        </Button>
      </div>
    </section>
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
  node,
  onFileLinkClick,
  onLoadDetail,
  responseHeader,
  runActive,
  runningToolActivityId,
  value,
}: {
  node: UserStoryActivityNode
  onFileLinkClick?: (path: string) => void
  onLoadDetail: (activity: UserStoryAgentActivity) => Promise<string>
  responseHeader: AgentConversationResponseHeader
  runActive: boolean
  runningToolActivityId?: string
  value: string
}) {
  if (node.type === "group") {
    return (
      <AgentActivityGroupItem
        node={node}
        onFileLinkClick={onFileLinkClick}
        onLoadDetail={onLoadDetail}
        responseHeader={responseHeader}
        runActive={runActive}
        runningToolActivityId={runningToolActivityId}
        value={value}
      />
    )
  }
  return (
    <AgentActivityLeafItem
      activity={node.activity}
      onFileLinkClick={onFileLinkClick}
      onLoadDetail={onLoadDetail}
      responseHeader={responseHeader}
      runActive={runActive}
      runningToolActivityId={runningToolActivityId}
      value={value}
    />
  )
}

function AgentActivityGroupItem({
  node,
  onFileLinkClick,
  onLoadDetail,
  responseHeader,
  runActive,
  runningToolActivityId,
  value,
}: {
  node: Extract<UserStoryActivityNode, { type: "group" }>
  onFileLinkClick?: (path: string) => void
  onLoadDetail: (activity: UserStoryAgentActivity) => Promise<string>
  responseHeader: AgentConversationResponseHeader
  runActive: boolean
  runningToolActivityId?: string
  value: string
}) {
  return (
    <AccordionItem value={value} className="border-b-0!">
      <div className="relative grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-1 text-sm">
        <span className="relative z-10 flex size-8 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm">
          <ListChecksIcon className="size-4" />
        </span>
        <div className="min-w-0">
          <AccordionTrigger className="min-h-8 items-center py-0 text-muted-foreground hover:no-underline">
            <span
              className={
                runActive &&
                groupIsRunning(node.activities, runningToolActivityId)
                  ? "agent-activity-running truncate"
                  : "truncate"
              }
            >
              {node.activities.length} parallel tools
            </span>
          </AccordionTrigger>
          <AccordionContent
            className="pt-2 pb-0"
            contentClassName="data-open:h-auto! data-open:overflow-visible"
          >
            <AgentActivityChildren
              nodes={node.children}
              onFileLinkClick={onFileLinkClick}
              onLoadDetail={onLoadDetail}
              parentValue={value}
              responseHeader={responseHeader}
              runActive={runActive}
              runningToolActivityId={runningToolActivityId}
            />
          </AccordionContent>
        </div>
      </div>
    </AccordionItem>
  )
}

function AgentActivityChildren({
  nodes,
  onFileLinkClick,
  onLoadDetail,
  parentValue,
  responseHeader,
  runActive,
  runningToolActivityId,
}: {
  nodes: UserStoryActivityNode[]
  onFileLinkClick?: (path: string) => void
  onLoadDetail: (activity: UserStoryAgentActivity) => Promise<string>
  parentValue: string
  responseHeader: AgentConversationResponseHeader
  runActive: boolean
  runningToolActivityId?: string
}) {
  return (
    <div className="relative grid gap-2">
      <span className="absolute top-0 bottom-0 left-4 w-px bg-muted-foreground/35" />
      <Accordion type="multiple" className="contents">
        {nodes.map((node) => (
          <AgentActivityItem
            key={node.id}
            node={node}
            onFileLinkClick={onFileLinkClick}
            onLoadDetail={onLoadDetail}
            responseHeader={responseHeader}
            runActive={runActive}
            runningToolActivityId={runningToolActivityId}
            value={`${parentValue}-${node.id}`}
          />
        ))}
      </Accordion>
    </div>
  )
}

function AgentActivityLeafItem({
  activity,
  onFileLinkClick,
  onLoadDetail,
  responseHeader,
  runActive,
  runningToolActivityId,
  value,
}: {
  activity: UserStoryAgentActivity
  onFileLinkClick?: (path: string) => void
  onLoadDetail: (activity: UserStoryAgentActivity) => Promise<string>
  responseHeader: AgentConversationResponseHeader
  runActive: boolean
  runningToolActivityId?: string
  value: string
}) {
  if (activity.kind === "message") {
    return (
      <AgentMarkdownTimelineItem
        highlight={activity.messageKind === "final"}
        icon={agentMessageIcon(responseHeader)}
        markdown={activity.detail}
        onFileLinkClick={onFileLinkClick}
        title={agentMessageTitle(activity, responseHeader)}
      />
    )
  }

  return (
    <AgentActivityDetailLeafItem
      activity={activity}
      onLoadDetail={onLoadDetail}
      runActive={runActive}
      runningToolActivityId={runningToolActivityId}
      value={value}
    />
  )
}

function AgentActivityDetailLeafItem({
  activity,
  onLoadDetail,
  runActive,
  runningToolActivityId,
  value,
}: {
  activity: UserStoryAgentActivity
  onLoadDetail: (activity: UserStoryAgentActivity) => Promise<string>
  runActive: boolean
  runningToolActivityId?: string
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
            <span
              className={
                activityIsRunning(activity, runActive, runningToolActivityId)
                  ? "agent-activity-running truncate"
                  : "truncate"
              }
            >
              {activityTitle(activity, details)}
            </span>
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

function currentRunningToolActivityId(
  runStatus: UserStoryAgentRun["status"],
  activities: UserStoryAgentActivity[]
) {
  const lastActivity = activities.at(-1)
  if (runStatus !== "running") return undefined
  if (lastActivity?.kind !== "tool") return undefined
  if (lastActivity.status !== "running") return undefined
  return lastActivity.id
}

function activityIsRunning(
  activity: UserStoryAgentActivity,
  runActive: boolean,
  runningToolActivityId: string | undefined
) {
  return (
    runActive &&
    activity.kind === "tool" &&
    activity.id === runningToolActivityId
  )
}

function groupIsRunning(
  activities: UserStoryAgentActivity[],
  runningToolActivityId: string | undefined
) {
  return activities.some((activity) => activity.id === runningToolActivityId)
}

function ActivityDetails({
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
  const loadButton = detailsHasArtifact(details) ? (
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
  activities,
  onFileLinkClick,
  response,
  responseHeader,
}: {
  activities: UserStoryAgentActivity[]
  onFileLinkClick?: (path: string) => void
  response?: string | null
  responseHeader: AgentConversationResponseHeader
}) {
  const markdown = response?.trim()
  if (!markdown) return null
  if (alreadyStreamedAgentMessage(markdown, activities)) return null

  return (
    <AgentMarkdownTimelineItem
      highlight
      icon={<ProviderMark provider={responseHeader.provider} />}
      markdown={markdown}
      onFileLinkClick={onFileLinkClick}
      title={responseHeader.modelName ?? "Agent response"}
    />
  )
}

function AgentMarkdownTimelineItem({
  highlight,
  icon,
  markdown,
  onFileLinkClick,
  title,
}: {
  highlight: boolean
  icon?: React.ReactNode
  markdown: string
  onFileLinkClick?: (path: string) => void
  title: React.ReactNode
}) {
  return (
    <div
      className="relative grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-1"
      data-agent-response
    >
      <span className="relative z-10 flex size-8 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm">
        {icon ?? <BotIcon className="size-4" />}
      </span>
      <div className="grid min-w-0 gap-3">
        <h3 className="text-xl font-medium">{title}</h3>
        <div className={highlight ? "agent-response-effect" : undefined}>
          <MarkdownEditor
            markdown={markdown}
            readOnly
            onFileLinkClick={onFileLinkClick}
            placeholder=""
            minHeight="min-h-24"
          />
        </div>
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
  detailArtifact?: string
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
    detailArtifact: activity.detailArtifact,
    durationMs: numberValue(parsed?.durationMs),
    fallback: activity.detail,
    input: parsed?.input,
    output: parsed?.output,
    raw: parsed?.raw,
    toolName,
  }
}

function detailsHasArtifact(details: ActivityDetail) {
  return Boolean(details.detailArtifact)
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

function agentMessageIcon(header: AgentConversationResponseHeader) {
  return <ProviderMark provider={header.provider} />
}

function agentMessageTitle(
  activity: UserStoryAgentActivity,
  header: AgentConversationResponseHeader
) {
  return header.modelName ?? activity.title
}

function agentDisplayActivities(
  activities: UserStoryAgentActivity[],
  response?: string | null
) {
  const markdown = response?.trim()
  const last = activities.at(-1)
  if (!markdown || last?.kind !== "message") return activities
  if (!sameStreamingMarkdown(last.detail, markdown)) return activities
  return [
    ...activities.slice(0, -1),
    {
      ...last,
      detail: markdown,
      messageKind: "final" as const,
      status: "completed" as const,
      title: "Agent response",
    },
  ]
}

function alreadyStreamedAgentMessage(
  markdown: string,
  activities: UserStoryAgentActivity[]
) {
  return activities.some(
    (activity) =>
      activity.kind === "message" && sameMarkdown(markdown, activity.detail)
  )
}

function sameStreamingMarkdown(left: string | undefined, right: string) {
  const normalizedLeft = normalizedMarkdown(left ?? "")
  const normalizedRight = normalizedMarkdown(right)
  if (!normalizedLeft) return false
  return (
    normalizedLeft === normalizedRight ||
    normalizedRight.startsWith(normalizedLeft) ||
    sameLeadingMarkdown(normalizedLeft, normalizedRight)
  )
}

function sameLeadingMarkdown(left: string, right: string) {
  const prefixLength = Math.min(left.length, right.length, 80)
  if (prefixLength < 40) return false
  return left.slice(0, prefixLength) === right.slice(0, prefixLength)
}

function sameMarkdown(left: string, right: string | undefined) {
  return normalizedMarkdown(left) === normalizedMarkdown(right ?? "")
}

function normalizedMarkdown(value: string) {
  return value.trim().replace(/\r\n?/g, "\n")
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
