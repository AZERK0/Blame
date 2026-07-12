import * as React from "react"
import {
  ArrowUpIcon,
  BrainCircuitIcon,
  CheckCircle2Icon,
  ClipboardCheckIcon,
  Code2Icon,
  CopyIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FileSearchIcon,
  ListChecksIcon,
  MessageSquareIcon,
  PencilIcon,
  RotateCcwIcon,
  SearchIcon,
  SquareIcon,
  TerminalIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "lucide-react"
import { toast } from "sonner"

import type {
  UserStoryAgentActivity,
  UserStoryAgentRunKind,
  UserStoryAgentRunStatus,
  UserStoryAgentUsage,
  UserStoryCodeSelectionAttachment,
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { publicAssetUrl } from "@/lib/public-asset-url"

type SpecialistAgentAppearance = {
  avatar: string
  color: string
  glowColor: string
}

const specialistAgentAppearances: Record<string, SpecialistAgentAppearance> = {
  "Codebase Analyst": {
    avatar: publicAssetUrl("agents/codebase-analyst.png"),
    color: "oklch(0.78 0.16 195)",
    glowColor: "oklch(0.72 0.19 195 / 28%)",
  },
  "Frontend Design Specialist": {
    avatar: publicAssetUrl("agents/frontend-design-specialist.png"),
    color: "oklch(0.75 0.23 350)",
    glowColor: "oklch(0.7 0.24 350 / 28%)",
  },
  "Risk & Review Analyst": {
    avatar: publicAssetUrl("agents/risk-review-analyst.png"),
    color: "oklch(0.78 0.19 55)",
    glowColor: "oklch(0.72 0.2 55 / 28%)",
  },
  "Story Analyst": {
    avatar: publicAssetUrl("agents/story-analyst.png"),
    color: "oklch(0.72 0.22 300)",
    glowColor: "oklch(0.67 0.23 300 / 28%)",
  },
  "Test & Verification Analyst": {
    avatar: publicAssetUrl("agents/test-verification-analyst.png"),
    color: "oklch(0.76 0.2 145)",
    glowColor: "oklch(0.7 0.2 145 / 28%)",
  },
}

export type AgentConversationComment = {
  author: string
  body: string
  codeSelectionAttachments?: UserStoryCodeSelectionAttachment[] | null
  createdAt: string
  fileAttachments?: UserStoryFileAttachment[] | null
  id: string
  updatedAt?: string | null
}

export type AgentConversationRun = {
  activities?: UserStoryAgentActivity[] | null
  clineSessionId?: string | null
  commentId?: string | null
  completedAt?: string | null
  createdAt: string
  finalResponse?: string | null
  id: string
  kind: UserStoryAgentRunKind
  messageId?: string | null
  sessionSummary?: string | null
  status: UserStoryAgentRunStatus
  updatedAt?: string | null
  usage?: UserStoryAgentUsage | null
}

export type AgentConversationUserMessageUndo = {
  checkpointRunCount: number
  comment: AgentConversationComment
  run: AgentConversationRun
}

type AgentConversationVisibleMessage =
  | { type: "activity"; activityId: string; runId: string }
  | { type: "comment"; runId: string }

export function AgentConversationTimeline({
  comments,
  onUserMessageUndo,
  onFileLinkClick,
  onLoadActivityDetail,
  responseHeader,
  runs,
}: {
  comments: AgentConversationComment[]
  onUserMessageUndo?: (
    target: AgentConversationUserMessageUndo
  ) => Promise<void> | void
  onFileLinkClick?: (path: string) => void
  onLoadActivityDetail?: (
    run: AgentConversationRun,
    activity: UserStoryAgentActivity
  ) => Promise<string>
  responseHeader: AgentConversationResponseHeader
  runs: AgentConversationRun[]
  topOffset?: "default" | "message-actions"
}) {
  const commentsById = React.useMemo(
    () => new Map(comments.map((comment) => [comment.id, comment])),
    [comments]
  )
  const loadActivityDetail = React.useCallback(
    (run: AgentConversationRun, activity: UserStoryAgentActivity) =>
      onLoadActivityDetail?.(run, activity) ?? Promise.resolve(activity.detail),
    [onLoadActivityDetail]
  )
  const lastVisibleMessage = React.useMemo(
    () => lastAgentConversationVisibleMessage(runs, commentsById),
    [commentsById, runs]
  )
  const highlightedFinalResponseRunId = React.useMemo(
    () => lastFinalResponseRunId(runs),
    [runs]
  )

  if (runs.length === 0) return null

  return (
    <div
      className="grid gap-10"
      aria-busy={runs.some((run) => run.status === "running")}
    >
      {runs.map((run, index) => (
        <AgentConversationTurn
          key={run.id}
          checkpointRunCount={index + 1}
          comment={runComment(run, commentsById)}
          highlightFinalResponse={run.id === highlightedFinalResponseRunId}
          lastVisibleMessage={lastVisibleMessage}
          onFileLinkClick={onFileLinkClick}
          onLoadActivityDetail={(activity) => loadActivityDetail(run, activity)}
          onUserMessageUndo={onUserMessageUndo}
          responseHeader={responseHeader}
          run={run}
        />
      ))}
    </div>
  )
}

function AgentConversationTurn({
  checkpointRunCount,
  comment,
  highlightFinalResponse,
  lastVisibleMessage,
  onFileLinkClick,
  onLoadActivityDetail,
  onUserMessageUndo,
  responseHeader,
  run,
}: {
  checkpointRunCount: number
  comment?: AgentConversationComment
  highlightFinalResponse: boolean
  lastVisibleMessage?: AgentConversationVisibleMessage
  onFileLinkClick?: (path: string) => void
  onLoadActivityDetail: (activity: UserStoryAgentActivity) => Promise<string>
  onUserMessageUndo?: (
    target: AgentConversationUserMessageUndo
  ) => Promise<void> | void
  responseHeader: AgentConversationResponseHeader
  run: AgentConversationRun
}) {
  const activities = agentDisplayActivities(
    run.activities ?? [],
    run.finalResponse,
    run.status
  )
  const finalMessage = [...activities]
    .reverse()
    .find(
      (activity) =>
        activity.kind === "message" && activity.messageKind === "final"
    )
  const visibleResponse = finalMessage ?? failedRunResponse(run, activities)
  const workActivities = visibleResponse
    ? activities.filter((activity) => activity.id !== visibleResponse.id)
    : activities

  return (
    <section className="grid gap-5" aria-label="Conversation turn">
      <RunCommentItem
        alwaysVisible={
          lastVisibleMessage?.type === "comment" &&
          lastVisibleMessage.runId === run.id
        }
        comment={comment}
        run={run}
        onFileLinkClick={onFileLinkClick}
        onUndo={
          comment && onUserMessageUndo
            ? () => onUserMessageUndo({ checkpointRunCount, comment, run })
            : undefined
        }
      />
      <div className="grid min-w-0 gap-5">
        <AgentWorkDetails
          activities={workActivities}
          onFileLinkClick={onFileLinkClick}
          onLoadDetail={onLoadActivityDetail}
          responseHeader={responseHeader}
          run={run}
        />
        {visibleResponse ? (
          <AgentMarkdownTimelineItem
            alwaysVisible={
              lastVisibleMessage?.type === "activity" &&
              lastVisibleMessage.runId === run.id
            }
            avatar={
              <AgentResponseAvatar
                activity={visibleResponse}
                responseHeader={responseHeader}
              />
            }
            createdAt={visibleResponse.createdAt}
            highlight={highlightFinalResponse && Boolean(finalMessage)}
            markdown={visibleResponse.detail}
            onFileLinkClick={onFileLinkClick}
            showFeedback={Boolean(finalMessage)}
          />
        ) : null}
      </div>
    </section>
  )
}

export function AgentConversationComposer({
  agentRunning = false,
  cancelingAgent = false,
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
  onAgentCancel,
  placeholder,
  submitLabel,
  title,
  toolbarEnd,
}: {
  agentRunning?: boolean
  cancelingAgent?: boolean
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
  onAgentCancel?: () => void
  placeholder: string
  submitLabel: string
  title?: string
  toolbarEnd?: React.ReactNode
}) {
  const hasMessageBody = Boolean(
    message.trim() || codeSelectionAttachments.length || fileAttachments.length
  )

  function submitMessage() {
    if (disabled || !hasMessageBody) return
    onMessageSubmit()
  }

  function handlePrimaryAction() {
    if (agentRunning) {
      if (!cancelingAgent) onAgentCancel?.()
      return
    }
    submitMessage()
  }

  const primaryActionLabel = agentRunning
    ? cancelingAgent
      ? "Canceling agent"
      : "Cancel agent"
    : submitLabel

  return (
    <section className="grid gap-3">
      {title ? (
        <div className="flex items-center gap-4 text-xl font-medium">
          <span className="flex size-11 items-center justify-center rounded-full border bg-muted text-muted-foreground shadow-sm">
            <MessageSquareIcon className="size-5" />
          </span>
          {title}
        </div>
      ) : null}
      <div className="relative">
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
          maxHeight="max-h-80"
          onSubmitShortcut={submitMessage}
          toolbarEnd={toolbarEnd}
        />
        <Button
          aria-label={primaryActionLabel}
          className={cn(
            "absolute top-3 right-3 z-10 size-9 rounded-full p-0 text-white shadow-lg disabled:border-muted disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none",
            agentRunning
              ? "border-destructive bg-destructive shadow-destructive/25 hover:bg-destructive/90 hover:text-white"
              : "border-blue-500 bg-blue-500 shadow-blue-500/25 hover:bg-blue-600 hover:text-white"
          )}
          disabled={
            agentRunning
              ? cancelingAgent || !onAgentCancel
              : disabled || !hasMessageBody
          }
          size="icon-sm"
          type="button"
          onClick={handlePrimaryAction}
        >
          {agentRunning ? (
            <SquareIcon className="size-3.5 fill-current" />
          ) : (
            <ArrowUpIcon className="size-4" />
          )}
        </Button>
      </div>
    </section>
  )
}

function RunCommentItem({
  alwaysVisible,
  comment,
  onFileLinkClick,
  onUndo,
  run,
}: {
  alwaysVisible: boolean
  comment?: AgentConversationComment
  onFileLinkClick?: (path: string) => void
  onUndo?: (comment: AgentConversationComment) => Promise<void> | void
  run: AgentConversationRun
}) {
  if (run.kind === "initial") return null
  if (!comment) return null

  return (
    <div className="group/message relative w-full min-w-0 pl-[12%]">
      <div className="ml-auto grid w-full max-w-3xl min-w-0 gap-2 overflow-hidden">
        <div className="max-w-full min-w-0 overflow-hidden rounded-3xl bg-muted/80 p-1 ring-1 ring-foreground/10 [&>div]:max-w-full [&>div]:min-w-0 [&>div]:bg-transparent [&>div]:shadow-none [&>div]:ring-0">
          <MarkdownEditor
            codeSelectionAttachments={comment.codeSelectionAttachments ?? []}
            fileAttachments={pendingFileAttachments(
              comment.fileAttachments ?? []
            )}
            markdown={comment.body}
            readOnly
            onFileLinkClick={onFileLinkClick}
            placeholder=""
            minHeight="min-h-0"
          />
        </div>
        <div className="flex items-center justify-end gap-2">
          <span className="text-xs text-muted-foreground">
            {commentDateLabel(comment.createdAt)}
          </span>
          <MarkdownMessageActions
            alwaysVisible={alwaysVisible}
            markdown={comment.body}
            onUndo={onUndo ? () => onUndo(comment) : undefined}
            undoDisabled={run.status === "running"}
          />
        </div>
      </div>
      <div className="absolute top-0 -right-10">
        <UserMessageAvatar author={comment.author} />
      </div>
    </div>
  )
}

function AgentWorkDetails({
  activities,
  onFileLinkClick,
  onLoadDetail,
  responseHeader,
  run,
}: {
  activities: UserStoryAgentActivity[]
  onFileLinkClick?: (path: string) => void
  onLoadDetail: (activity: UserStoryAgentActivity) => Promise<string>
  responseHeader: AgentConversationResponseHeader
  run: AgentConversationRun
}) {
  const running = run.status === "running"
  const [open, setOpen] = React.useState(false)
  const runningToolActivityId = currentRunningToolActivityId(
    run.status,
    activities
  )
  const thinking = agentThinkingVisible(run.status, activities)

  if (activities.length === 0 && !thinking) return null

  const stepCount = activities.filter(
    (activity) => activity.kind !== "message"
  ).length
  const stateLabel = running
    ? "Working"
    : run.status === "failed"
      ? "Work stopped"
      : "Work completed"

  return (
    <Accordion
      type="single"
      collapsible
      value={running || open ? "work" : ""}
      onValueChange={(value) => {
        if (!running) setOpen(value === "work")
      }}
    >
      <AccordionItem value="work" className="border-0 px-0">
        <AccordionTrigger className="min-h-10 items-center justify-start gap-2 py-1 text-muted-foreground hover:no-underline [&>svg]:ml-0">
          <span className="flex min-w-0 items-center gap-2.5 text-sm">
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                running
                  ? "agent-thinking-mark"
                  : run.status === "failed"
                    ? "bg-destructive"
                    : "bg-emerald-500"
              )}
              aria-hidden="true"
            />
            <span className={running ? "agent-activity-running" : undefined}>
              {stateLabel}
            </span>
            <span className="font-normal text-muted-foreground">
              · {stepCount || activities.length}{" "}
              {stepCount === 1 ? "step" : "steps"}
            </span>
          </span>
        </AccordionTrigger>
        <AccordionContent className="pt-2 pb-2 pl-1">
          <Accordion type="multiple" className="grid gap-1">
            {userStoryActivityTree(activities).map((node) => (
              <AgentActivityItem
                key={`${run.id}-${node.id}`}
                node={node}
                onFileLinkClick={onFileLinkClick}
                onLoadDetail={onLoadDetail}
                responseHeader={responseHeader}
                runActive={running}
                runningToolActivityId={runningToolActivityId}
                value={`${run.id}-${node.id}`}
              />
            ))}
          </Accordion>
          {thinking ? <AgentThinkingTimelineItem /> : null}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

function AgentThinkingTimelineItem() {
  return (
    <div
      className="flex min-w-0 items-center gap-3 px-2 py-2 text-sm text-muted-foreground"
      role="status"
    >
      <span className="agent-thinking-mark" aria-hidden="true" />
      <span className="agent-thinking-text">Thinking</span>
    </div>
  )
}

function AgentActivityItem({
  alwaysVisibleActivityId,
  node,
  onFileLinkClick,
  onLoadDetail,
  responseHeader,
  runActive,
  runningToolActivityId,
  value,
}: {
  alwaysVisibleActivityId?: string
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
        alwaysVisibleActivityId={alwaysVisibleActivityId}
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
      alwaysVisible={node.activity.id === alwaysVisibleActivityId}
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
  alwaysVisibleActivityId,
  node,
  onFileLinkClick,
  onLoadDetail,
  responseHeader,
  runActive,
  runningToolActivityId,
  value,
}: {
  alwaysVisibleActivityId?: string
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
      <div className="grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-2 text-sm">
        <span className="flex size-8 items-center justify-center text-muted-foreground">
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
              alwaysVisibleActivityId={alwaysVisibleActivityId}
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
  alwaysVisibleActivityId,
  nodes,
  onFileLinkClick,
  onLoadDetail,
  parentValue,
  responseHeader,
  runActive,
  runningToolActivityId,
}: {
  alwaysVisibleActivityId?: string
  nodes: UserStoryActivityNode[]
  onFileLinkClick?: (path: string) => void
  onLoadDetail: (activity: UserStoryAgentActivity) => Promise<string>
  parentValue: string
  responseHeader: AgentConversationResponseHeader
  runActive: boolean
  runningToolActivityId?: string
}) {
  return (
    <div className="grid gap-1 border-l pl-3">
      <Accordion type="multiple" className="contents">
        {nodes.map((node) => (
          <AgentActivityItem
            alwaysVisibleActivityId={alwaysVisibleActivityId}
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
  alwaysVisible,
  activity,
  onFileLinkClick,
  onLoadDetail,
  responseHeader,
  runActive,
  runningToolActivityId,
  value,
}: {
  alwaysVisible: boolean
  activity: UserStoryAgentActivity
  onFileLinkClick?: (path: string) => void
  onLoadDetail: (activity: UserStoryAgentActivity) => Promise<string>
  responseHeader: AgentConversationResponseHeader
  runActive: boolean
  runningToolActivityId?: string
  value: string
}) {
  if (activity.kind === "message") {
    const specialistAppearance = specialistAgentAppearance(activity)
    return (
      <AgentMarkdownTimelineItem
        alwaysVisible={alwaysVisible}
        createdAt={activity.createdAt}
        effectColor={specialistAppearance?.color}
        effectGlowColor={specialistAppearance?.glowColor}
        highlight={false}
        markdown={activity.detail}
        onFileLinkClick={onFileLinkClick}
        showFeedback={activity.messageKind === "final"}
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
      <div className="grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-2 text-sm">
        <span className="flex size-8 items-center justify-center text-muted-foreground">
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
  runStatus: AgentConversationRun["status"],
  activities: UserStoryAgentActivity[]
) {
  const lastActivity = activities.at(-1)
  if (runStatus !== "running") return undefined
  if (lastActivity?.kind !== "tool") return undefined
  if (lastActivity.status !== "running") return undefined
  return lastActivity.id
}

function lastAgentConversationVisibleMessage(
  runs: AgentConversationRun[],
  commentsById: Map<string, AgentConversationComment>
): AgentConversationVisibleMessage | undefined {
  let lastMessage: AgentConversationVisibleMessage | undefined
  for (const run of runs) {
    if (run.kind !== "initial" && runComment(run, commentsById)) {
      lastMessage = { runId: run.id, type: "comment" }
    }
    const activities = agentDisplayActivities(
      run.activities ?? [],
      run.finalResponse,
      run.status
    )
    for (const activity of activities) {
      if (activity.kind === "message") {
        lastMessage = {
          activityId: activity.id,
          runId: run.id,
          type: "activity",
        }
      }
    }
  }
  return lastMessage
}

function lastFinalResponseRunId(runs: AgentConversationRun[]) {
  return [...runs]
    .reverse()
    .find((run) =>
      agentDisplayActivities(
        run.activities ?? [],
        run.finalResponse,
        run.status
      ).some(
        (activity) =>
          activity.kind === "message" && activity.messageKind === "final"
      )
    )?.id
}

function agentThinkingVisible(
  status: AgentConversationRun["status"],
  activities: UserStoryAgentActivity[]
) {
  if (status !== "running") return false
  const lastActivity = activities.at(-1)
  if (!lastActivity) return true
  return lastActivity.kind !== "tool" || lastActivity.status !== "running"
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
  const inspectedFiles = readFilesInput(details)
  const editedFiles = applyPatchInput(details)
  const customDetails = toolDetailContent(details)
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

  if (!customDetails && !inspectedFiles && !editedFiles) {
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
      {inspectedFiles ? <InspectedFiles files={inspectedFiles} /> : null}
      {editedFiles ? <EditedFiles files={editedFiles} /> : null}
      {customDetails}
      {loadButton}
    </div>
  )
}

function ToolSurface({
  children,
  durationMs,
  label,
}: {
  children: React.ReactNode
  durationMs?: number
  label: string
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border bg-muted/15">
      <div className="flex items-center justify-between gap-3 border-b bg-muted/25 px-3 py-2 text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        {durationMs !== undefined ? (
          <span className="tabular-nums">{durationMs} ms</span>
        ) : null}
      </div>
      <div className="grid min-w-0 gap-2 p-2.5">{children}</div>
    </div>
  )
}

function ToolRows({
  emptyLabel,
  values,
}: {
  emptyLabel: string
  values: string[]
}) {
  if (values.length === 0)
    return <p className="px-1 text-xs text-muted-foreground">{emptyLabel}</p>
  return (
    <div className="grid gap-1.5">
      {values.map((value, index) => (
        <div
          className="min-w-0 rounded-md bg-background/70 px-3 py-2 font-mono text-xs leading-relaxed text-foreground/85"
          key={`${value}-${index}`}
        >
          <div className="overflow-x-auto whitespace-pre-wrap break-words">{value}</div>
        </div>
      ))}
    </div>
  )
}

function ResultCards({ value }: { value: unknown }) {
  const entries = outputEntries(value)
  return (
    <div className="grid gap-2">
      {entries.map((entry, index) => (
        <div className="min-w-0 rounded-md bg-background/70 p-3" key={index}>
          <div className="mb-2 flex min-w-0 items-center justify-between gap-3 text-xs">
            <span className="truncate font-medium" title={entry.query}>
              {entry.query || `Result ${index + 1}`}
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 font-medium",
                entry.success === false
                  ? "bg-red-500/10 text-red-600 dark:text-red-400"
                  : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              )}
            >
              {entry.success === false ? "Failed" : "Completed"}
            </span>
          </div>
          {entry.result ? (
            <div>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-muted-foreground">
                {entry.result.text}
              </pre>
              {entry.result.truncated ? (
                <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
                  Showing a compact preview. Load full detail for the complete result.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function toolDetailContent(details: ActivityDetail): React.ReactNode {
  if (readFilesInput(details) || applyPatchInput(details)) return null
  const input = recordValue(details.input)
  const toolName = details.toolName ?? "tool"

  if (toolName === "search_codebase") {
    return (
      <ToolSurface durationMs={details.durationMs} label="Search patterns">
        <ToolRows
          emptyLabel="No search pattern provided"
          values={stringArray(input.queries)}
        />
        {details.output !== undefined ? <ResultCards value={details.output} /> : null}
      </ToolSurface>
    )
  }

  if (toolName === "run_commands") {
    return (
      <ToolSurface durationMs={details.durationMs} label="Terminal session">
        <ToolRows
          emptyLabel="No command provided"
          values={stringArray(input.commands)}
        />
        {details.output !== undefined ? <ResultCards value={details.output} /> : null}
      </ToolSurface>
    )
  }

  if (toolName === "fetch_web_content") {
    const requests = arrayValue(input.requests).map((request) => {
      const value = recordValue(request)
      return [stringValue(value.url), stringValue(value.prompt)]
        .filter((part): part is string => Boolean(part))
        .join("\n")
    })
    return (
      <ToolSurface durationMs={details.durationMs} label="Web content">
        <ToolRows emptyLabel="No URL provided" values={requests} />
        {details.output !== undefined ? <ResultCards value={details.output} /> : null}
      </ToolSurface>
    )
  }

  if (toolName === "skills") {
    const skill = stringValue(input.skill)
    const args = stringValue(input.args)
    return (
      <ToolSurface durationMs={details.durationMs} label="Skill invocation">
        <ToolRows
          emptyLabel="No skill specified"
          values={skill ? [`/${skill}${args ? ` ${args}` : ""}`] : []}
        />
        {details.output !== undefined ? <ResultCards value={details.output} /> : null}
      </ToolSurface>
    )
  }

  if (codeGraphTool(toolName)) {
    return (
      <ToolSurface durationMs={details.durationMs} label={toolLabel(toolName)}>
        <StructuredValue label="Scope" value={details.input} />
        <StructuredValue label="Graph report" value={details.output} />
      </ToolSurface>
    )
  }

  if (toolName === "get_preview_devtools" || toolName === "get_preview_container_logs") {
    return (
      <ToolSurface durationMs={details.durationMs} label="Preview diagnostics">
        <StructuredValue label="Request" value={details.input} />
        <StructuredValue label="Status" value={details.output} />
      </ToolSurface>
    )
  }

  return (
    <ToolSurface durationMs={details.durationMs} label={toolLabel(toolName)}>
      <StructuredValue label="Input" value={details.input} />
      <StructuredValue label="Output" value={details.output} />
    </ToolSurface>
  )
}

function StructuredValue({ label, value }: { label: string; value: unknown }) {
  if (value === undefined || value === null) return null
  if (Array.isArray(value)) {
    return (
      <div className="grid gap-1.5">
        <span className="px-1 text-xs font-medium text-muted-foreground">{label}</span>
        {value.map((entry, index) => (
          <StructuredValue key={index} label={`Item ${index + 1}`} value={entry} />
        ))}
      </div>
    )
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, entry]) => entry !== undefined && entry !== null
    )
    return (
      <div className="grid gap-1.5 rounded-md bg-background/70 p-3">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <dl className="grid gap-2">
          {entries.map(([key, entry]) => (
            <div className="grid min-w-0 gap-0.5 sm:grid-cols-[9rem_1fr]" key={key}>
              <dt className="truncate text-xs text-muted-foreground" title={key}>
                {humanizeToolName(key)}
              </dt>
              <dd className="min-w-0">
                {typeof entry === "object" ? (
                  <StructuredValue label={humanizeToolName(key)} value={entry} />
                ) : (
                  <span className="block overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground/85">
                    {displayScalar(entry)}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    )
  }
  return (
    <div className="rounded-md bg-background/70 p-3">
      <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
        {displayScalar(value)}
      </pre>
    </div>
  )
}

type EditedFile = {
  additions?: number
  deletions?: number
  path: string
}

function EditedFiles({ files }: { files: EditedFile[] }) {
  return (
    <div className="grid gap-1.5 py-0.5">
      {files.map((file) => {
        const { name } = splitFilePath(file.path)
        return (
          <div
            className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground"
            key={file.path}
            title={file.path}
          >
            <span className="shrink-0">Edited</span>
            <span className="truncate text-sky-600 dark:text-sky-400">
              {name}
            </span>
            {file.additions !== undefined ? (
              <span className="shrink-0 text-emerald-600 dark:text-emerald-400">
                +{file.additions}
              </span>
            ) : null}
            {file.deletions !== undefined ? (
              <span className="shrink-0 text-red-600 dark:text-red-400">
                -{file.deletions}
              </span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

type InspectedFile = {
  endLine?: number
  path: string
  startLine?: number
}

function InspectedFiles({ files }: { files: InspectedFile[] }) {
  return (
    <div className="grid gap-1.5 py-0.5">
      {files.map((file, index) => {
        const { name } = splitFilePath(file.path)
        const lineCount = inspectedLineCount(file)
        return (
          <div
            className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground"
            key={`${file.path}-${file.startLine ?? "start"}-${file.endLine ?? "end"}-${index}`}
            title={file.path}
          >
            <span className="shrink-0">Read</span>
            <span className="truncate text-sky-600 dark:text-sky-400">
              {name}
            </span>
            <span className="shrink-0 text-muted-foreground/70">
              {inspectedLineRange(file)}
            </span>
            {lineCount !== undefined ? (
              <span className="shrink-0 text-emerald-600 dark:text-emerald-400">
                {lineCount} {lineCount === 1 ? "line" : "lines"}
              </span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function AgentMarkdownTimelineItem({
  alwaysVisible,
  avatar,
  createdAt,
  effectColor,
  effectGlowColor,
  highlight,
  markdown,
  onFileLinkClick,
  showFeedback,
}: {
  alwaysVisible: boolean
  avatar?: React.ReactNode
  createdAt: string
  effectColor?: string
  effectGlowColor?: string
  highlight: boolean
  markdown: string
  onFileLinkClick?: (path: string) => void
  showFeedback?: boolean
}) {
  const contentRef = React.useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = React.useState(false)
  const [contentOverflows, setContentOverflows] = React.useState(false)
  const [contentHeight, setContentHeight] = React.useState(320)
  const collapsible = Boolean(effectColor)
  const effectStyle =
    effectColor && effectGlowColor
      ? ({
          "--agent-response-color": effectColor,
          "--agent-response-glow-color": effectGlowColor,
        } as React.CSSProperties)
      : undefined

  React.useEffect(() => {
    const content = contentRef.current
    if (!collapsible || !content) {
      setContentOverflows(false)
      return
    }

    const updateOverflow = () => {
      const nextHeight = content.scrollHeight
      setContentHeight(nextHeight)
      setContentOverflows(nextHeight > 320)
    }
    updateOverflow()
    const observer = new ResizeObserver(updateOverflow)
    observer.observe(content)
    return () => observer.disconnect()
  }, [collapsible, markdown])

  return (
    <div className="group/message relative min-w-0" data-agent-response>
      {avatar ? <div className="absolute top-0 -left-10">{avatar}</div> : null}
      <div className="grid min-w-0 gap-2">
        <div
          className={cn(
            "min-w-0 [&>div]:bg-transparent [&>div]:p-0 [&>div]:shadow-none [&>div]:ring-0",
            highlight && "agent-response-effect",
            effectColor && "sub-agent-response-effect",
            collapsible &&
              contentOverflows &&
              !expanded &&
              "sub-agent-response-collapsed"
          )}
          style={effectStyle}
        >
          <div
            ref={contentRef}
            className={cn(
              "relative [&>div]:bg-transparent [&>div]:p-0 [&>div]:shadow-none [&>div]:ring-0",
              effectColor && "sub-agent-response-content",
              collapsible &&
                "overflow-hidden transition-[max-height] duration-500 ease-in-out motion-reduce:transition-none"
            )}
            style={
              collapsible
                ? { maxHeight: expanded ? `${contentHeight}px` : "20rem" }
                : undefined
            }
          >
            <MarkdownEditor
              markdown={markdown}
              readOnly
              onFileLinkClick={onFileLinkClick}
              placeholder=""
              minHeight="min-h-0"
            />
          </div>
          {collapsible && contentOverflows ? (
            <Button
              aria-label={
                expanded ? "Replier la réponse" : "Afficher la réponse complète"
              }
              className="sub-agent-response-toggle absolute bottom-2 left-1/2 z-2 -translate-x-1/2 rounded-full shadow-sm transition-[background-color,transform] duration-300 motion-reduce:transition-none"
              onClick={() => setExpanded((value) => !value)}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              {expanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
            </Button>
          ) : null}
        </div>
        <MarkdownMessageActions
          alwaysVisible={alwaysVisible}
          createdAt={createdAt}
          markdown={markdown}
          showFeedback={showFeedback}
        />
      </div>
    </div>
  )
}

function UserMessageAvatar({ author }: { author: string }) {
  return (
    <Avatar size="default" aria-label={author}>
      <AvatarFallback>{agentInitials(author)}</AvatarFallback>
    </Avatar>
  )
}

function AgentResponseAvatar({
  activity,
  responseHeader,
}: {
  activity: UserStoryAgentActivity
  responseHeader: AgentConversationResponseHeader
}) {
  const specialistAppearance = specialistAgentAppearance(activity)
  const avatar = activity.agentAvatar ?? specialistAppearance?.avatar
  if (avatar) {
    const name = activity.agentName ?? "Agent"
    return (
      <Avatar aria-label={name}>
        <AvatarImage alt={name} src={avatar} />
        <AvatarFallback>{agentInitials(name)}</AvatarFallback>
      </Avatar>
    )
  }

  return (
    <span
      aria-label={activity.agentName ?? responseHeader.provider.name}
      className="flex size-8 shrink-0 items-center justify-center rounded-full border bg-background"
    >
      <ProviderMark provider={responseHeader.provider} />
    </span>
  )
}

function specialistAgentAppearance(activity: UserStoryAgentActivity) {
  if (activity.messageKind !== "intermediate" || !activity.agentName) {
    return undefined
  }
  return specialistAgentAppearanceByName(activity.agentName)
}

function specialistAgentAppearanceByName(name: string | undefined) {
  return name ? specialistAgentAppearances[name] : undefined
}

function agentInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}

export function MarkdownMessageActions({
  alwaysVisible = true,
  createdAt,
  markdown,
  onUndo,
  showFeedback,
  undoDisabled,
}: {
  alwaysVisible?: boolean
  createdAt?: string | null
  markdown: string
  onUndo?: () => Promise<void> | void
  showFeedback?: boolean
  undoDisabled?: boolean
}) {
  const [feedback, setFeedback] = React.useState<"dislike" | "like">()
  const [undoing, setUndoing] = React.useState(false)
  const dateLabel = messageActionDateLabel(createdAt)

  async function copy() {
    try {
      await writeClipboardText(markdown)
      toast.success("Message copied.", { position: "bottom-right" })
    } catch (error) {
      toast.error("Unable to copy", {
        description: errorMessage(error),
        position: "bottom-right",
      })
    }
  }

  async function undo() {
    if (!onUndo || undoing) return
    setUndoing(true)
    try {
      await onUndo()
    } catch (error) {
      toast.error("Unable to undo message", {
        description: errorMessage(error),
        position: "bottom-right",
      })
    } finally {
      setUndoing(false)
    }
  }

  function preventMouseFocus(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
  }

  return (
    <div
      className={cn(
        "flex min-h-6 items-center gap-3 transition-opacity",
        alwaysVisible
          ? "opacity-100"
          : "pointer-events-none opacity-0 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100 group-hover/message:pointer-events-auto group-hover/message:opacity-100"
      )}
    >
      <div className="ml-auto flex shrink-0 items-center gap-3">
        {dateLabel ? (
          <time
            className="shrink-0 text-xs font-medium text-muted-foreground"
            dateTime={createdAt ?? undefined}
          >
            {dateLabel}
          </time>
        ) : null}
        <div className="flex shrink-0 items-center gap-1.5">
          <MarkdownActionTooltip label="Copy">
            <Button
              aria-label="Copy"
              onMouseDown={preventMouseFocus}
              onClick={copy}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <CopyIcon className="size-3" />
            </Button>
          </MarkdownActionTooltip>
          {onUndo ? (
            <MarkdownActionTooltip label={undoing ? "Undoing" : "Undo"}>
              <Button
                aria-label={undoing ? "Undoing" : "Undo"}
                disabled={undoDisabled || undoing}
                onMouseDown={preventMouseFocus}
                onClick={undo}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <RotateCcwIcon className="size-3" />
              </Button>
            </MarkdownActionTooltip>
          ) : null}
          {showFeedback ? (
            <>
              <MarkdownActionTooltip label="Like">
                <Button
                  aria-label="Like"
                  aria-pressed={feedback === "like"}
                  className={
                    feedback === "like"
                      ? "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
                      : undefined
                  }
                  onClick={() =>
                    setFeedback(feedback === "like" ? undefined : "like")
                  }
                  onMouseDown={preventMouseFocus}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <ThumbsUpIcon className="size-3" />
                </Button>
              </MarkdownActionTooltip>
              <MarkdownActionTooltip label="Dislike">
                <Button
                  aria-label="Dislike"
                  aria-pressed={feedback === "dislike"}
                  className={
                    feedback === "dislike"
                      ? "bg-destructive/10 text-destructive hover:!bg-destructive/15 dark:bg-destructive/20 dark:hover:!bg-destructive/30"
                      : undefined
                  }
                  onClick={() =>
                    setFeedback(feedback === "dislike" ? undefined : "dislike")
                  }
                  onMouseDown={preventMouseFocus}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <ThumbsDownIcon className="size-3" />
                </Button>
              </MarkdownActionTooltip>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function MarkdownActionTooltip({
  children,
  label,
}: {
  children: React.ReactNode
  label: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function ActivityToolIcon({
  activity,
  toolName,
}: {
  activity: UserStoryAgentActivity
  toolName: string | undefined
}) {
  if (activity.kind === "tool" && toolName === "spawn_agent") {
    const name = activity.agentName ?? "Agent"
    const avatar =
      activity.agentAvatar ??
      specialistAgentAppearanceByName(activity.agentName)?.avatar
    if (avatar) {
      return (
        <Avatar size="sm" aria-label={name}>
          <AvatarImage alt={name} src={avatar} />
          <AvatarFallback>{agentInitials(name)}</AvatarFallback>
        </Avatar>
      )
    }
  }
  if (activity.kind === "reasoning")
    return <BrainCircuitIcon className="size-4" />
  if (activity.kind === "approval")
    return <CheckCircle2Icon className="size-4" />
  if (activity.kind !== "tool") return <MessageSquareIcon className="size-4" />
  if (toolName === "run_commands") return <TerminalIcon className="size-4" />
  if (toolName === "search_codebase") return <SearchIcon className="size-4" />
  if (toolName === "read_files") return <FileSearchIcon className="size-4" />
  if (toolName === "apply_patch") return <Code2Icon className="size-4" />
  if (toolName === "editor") return <PencilIcon className="size-4" />
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

type DisplayText = {
  text: string
  truncated: boolean
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
  const inspectedFiles = readFilesInput(details)
  if (inspectedFiles) {
    return `Read ${inspectedFiles.length} ${inspectedFiles.length === 1 ? "file" : "files"}`
  }
  const editedFiles = applyPatchInput(details)
  if (editedFiles) {
    return `Edited ${editedFiles.length} ${editedFiles.length === 1 ? "file" : "files"}`
  }
  if (details.toolName === "spawn_agent" && activity.agentName) {
    return activity.agentName
  }
  return toolLabel(details.toolName ?? activity.title)
}

function applyPatchInput(details: ActivityDetail): EditedFile[] | undefined {
  const patch =
    details.toolName === "apply_patch"
      ? applyPatchExcerpt(details.input)
      : undefined
  if (!patch) return appliedPatchOutputFiles(details.output)

  const files: EditedFile[] = []
  let current: EditedFile | undefined
  for (const line of patch.split("\n")) {
    const path = line.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/)?.[1]
    if (path) {
      current = { additions: 0, deletions: 0, path: path.trim() }
      files.push(current)
      continue
    }
    if (!current || line.startsWith("+++ ") || line.startsWith("--- ")) continue
    if (line.startsWith("+")) current.additions += 1
    if (line.startsWith("-")) current.deletions += 1
  }
  return files.length > 0 ? files : undefined
}

function appliedPatchOutputFiles(value: unknown): EditedFile[] | undefined {
  const pending = [value]
  const visited = new Set<object>()

  while (pending.length > 0) {
    let candidate = pending.shift()
    if (typeof candidate === "string") {
      try {
        candidate = JSON.parse(candidate)
      } catch {
        continue
      }
    }
    if (!candidate || typeof candidate !== "object") continue
    if (visited.has(candidate)) continue
    visited.add(candidate)

    if (Array.isArray(candidate)) {
      pending.push(...candidate)
      continue
    }

    const output = candidate as Record<string, unknown>
    if (stringValue(output.query) !== "apply_patch" || output.success === false)
      continue
    const result = stringValue(output.result)
    if (!result) continue
    const fileList = result.match(
      /Successfully applied patch to the following files:\s*([\s\S]*)/i
    )?.[1]
    if (!fileList) continue
    const files = fileList
      .split("\n")
      .map((path) => path.trim())
      .filter(Boolean)
      .map((path) => ({ path }))
    if (files.length > 0) return files
  }

  return undefined
}

function applyPatchExcerpt(value: unknown): string | undefined {
  const pending = [value]
  const visited = new Set<object>()

  while (pending.length > 0) {
    const candidate = pending.shift()
    if (typeof candidate === "string") return candidate
    if (!candidate || typeof candidate !== "object") continue
    if (visited.has(candidate)) continue
    visited.add(candidate)

    if (Array.isArray(candidate)) {
      pending.unshift(...candidate)
      continue
    }

    const record = candidate as Record<string, unknown>
    const excerpt = stringValue(record.excerpt)
    if (excerpt) return excerpt
    if (record.input !== undefined) pending.unshift(record.input)
  }

  return undefined
}

function readFilesInput(details: ActivityDetail): InspectedFile[] | undefined {
  if (details.toolName !== "read_files") return undefined
  const input = recordValue(details.input)
  if (!Array.isArray(input.files)) return undefined

  const files = input.files.flatMap((value): InspectedFile[] => {
    const file = recordValue(value)
    const path = stringValue(file.path)
    if (!path) return []
    return [
      {
        endLine: positiveInteger(file.end_line),
        path,
        startLine: positiveInteger(file.start_line),
      },
    ]
  })
  return files.length > 0 ? files : undefined
}

function positiveInteger(value: unknown) {
  const number = numberValue(value)
  return number !== undefined && Number.isInteger(number) && number > 0
    ? number
    : undefined
}

function inspectedLineCount(file: InspectedFile) {
  if (file.startLine === undefined || file.endLine === undefined)
    return undefined
  return Math.abs(file.endLine - file.startLine) + 1
}

function inspectedLineRange(file: InspectedFile) {
  if (file.startLine !== undefined && file.endLine !== undefined) {
    return `L${file.startLine}–${file.endLine}`
  }
  if (file.startLine !== undefined) return `From L${file.startLine}`
  if (file.endLine !== undefined) return `Through L${file.endLine}`
  return "Entire file"
}

function splitFilePath(path: string) {
  const normalized = path.replaceAll("\\", "/")
  const separator = normalized.lastIndexOf("/")
  if (separator < 0) return { directory: "", name: normalized }
  return {
    directory: normalized.slice(0, separator),
    name: normalized.slice(separator + 1) || normalized,
  }
}

function outputEntries(value: unknown) {
  return arrayValue(value).map((item) => {
    const entry = recordValue(item)
    return {
      query: displayText(entry.query)?.text ?? "",
      result: displayText(entry.result) ?? displayText(scalarSummary(item)),
      success: typeof entry.success === "boolean" ? entry.success : undefined,
    }
  })
}

function arrayValue(value: unknown) {
  if (Array.isArray(value)) return value
  return value === undefined || value === null ? [] : [value]
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : []
}

function scalarSummary(value: unknown) {
  if (typeof value === "string") return value
  if (!value || typeof value !== "object") return displayScalar(value)
  const record = value as Record<string, unknown>
  return record.output ?? record.message ?? record.reason ?? ""
}

function displayText(value: unknown): DisplayText | undefined {
  if (typeof value === "string") return { text: value, truncated: false }
  const compact = recordValue(value)
  const excerpt = stringValue(compact.excerpt)
  if (!excerpt) return undefined
  return { text: excerpt, truncated: compact.truncated === true }
}

function displayScalar(value: unknown) {
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (value === undefined) return "Not provided"
  if (value === null) return "None"
  return String(value)
}

function codeGraphTool(toolName: string) {
  return [
    "get_code_minimal_context",
    "get_code_review_context",
    "get_code_impact_radius",
    "get_code_architecture_overview",
    "get_code_graph_status",
    "update_code_graph",
  ].includes(toolName)
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
  if (normalized === "fetch_web_content") return "Web content"
  if (normalized === "apply_patch") return "Code edit"
  if (normalized === "editor") return "File edit"
  if (normalized === "write_file") return "File write"
  if (normalized === "list_files") return "File listing"
  if (normalized === "get_preview_devtools") return "Preview DevTools"
  if (normalized === "get_preview_container_logs") return "Preview logs"
  if (normalized === "get_code_minimal_context") return "Code context"
  if (normalized === "get_code_review_context") return "Code review context"
  if (normalized === "get_code_impact_radius") return "Code impact"
  if (normalized === "get_code_architecture_overview")
    return "Architecture overview"
  if (normalized === "get_code_graph_status") return "Code graph status"
  if (normalized === "update_code_graph") return "Code graph update"
  if (normalized === "skills") return "Skill"
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

function agentDisplayActivities(
  activities: UserStoryAgentActivity[],
  response: string | null | undefined,
  status: AgentConversationRun["status"]
) {
  const markdown = response?.trim()
  const last = activities.at(-1)
  if (last?.kind !== "message") return activities
  const finalDetail =
    markdown && sameStreamingMarkdown(last.detail, markdown)
      ? markdown
      : last.detail
  if (status !== "completed" && finalDetail === last.detail) return activities
  return [
    ...activities.slice(0, -1),
    {
      ...last,
      detail: finalDetail,
      messageKind: "final" as const,
      status: "completed" as const,
      title: "Agent response",
    },
  ]
}

function failedRunResponse(
  run: AgentConversationRun,
  activities: UserStoryAgentActivity[]
): UserStoryAgentActivity | undefined {
  if (run.status !== "failed") return undefined
  const message = [...activities]
    .reverse()
    .find((activity) => activity.kind === "message")
  if (message) return message
  const response = run.finalResponse?.trim()
  if (!response) return undefined
  return {
    createdAt: run.completedAt ?? run.updatedAt ?? run.createdAt,
    detail: response,
    id: `${run.id}-failed-response`,
    kind: "message",
    messageKind: "final",
    status: "failed",
    title: "Agent error",
  }
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

function normalizedMarkdown(value: string) {
  return value.trim().replace(/\r\n?/g, "\n")
}

function truncateMiddle(value: string | undefined, maxLength: number) {
  if (!value) return ""
  if (value.length <= maxLength) return value
  const edgeLength = Math.floor((maxLength - 20) / 2)
  return `${value.slice(0, edgeLength)}\n...\n${value.slice(-edgeLength)}`
}

async function writeClipboardText(value: string) {
  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard is not available.")
  }
  await navigator.clipboard.writeText(value)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
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

function messageActionDateLabel(value: string | null | undefined) {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

function runComment(
  run: AgentConversationRun,
  commentsById: Map<string, AgentConversationComment>
) {
  const commentId = run.commentId ?? run.messageId
  return commentId ? commentsById.get(commentId) : undefined
}
