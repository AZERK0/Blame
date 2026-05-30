import * as React from "react"
import {
  BotIcon,
  BrainCircuitIcon,
  CheckCircle2Icon,
  ClipboardCheckIcon,
  Code2Icon,
  FileSearchIcon,
  FileTextIcon,
  GitBranchIcon,
  ListChecksIcon,
  MessageSquareIcon,
  PencilIcon,
  SearchIcon,
  TerminalIcon,
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
  commentRef,
  mode,
  onSummaryChange,
  onSummaryOptimize,
  onFileLinkClick,
  status,
  summary,
  summaryCodeSelectionAttachments,
  summaryRef,
  userStory,
}: {
  commentCodeSelectionAttachments: PendingCodeSelectionAttachment[]
  commentFileAttachments?: PendingFileAttachment[]
  commentRef: React.RefObject<HTMLDivElement | null>
  mode: UserStoryDrawerMode
  onSummaryChange?: (summary: string) => void
  onSummaryOptimize?: (summary: string) => Promise<string>
  onFileLinkClick?: (path: string) => void
  status: BacklogColumnId
  summary: string
  summaryCodeSelectionAttachments: PendingCodeSelectionAttachment[]
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
        mentionDirectory={mentionDirectory}
        ref={summaryRef}
        markdown={summary}
        onFileLinkClick={onFileLinkClick}
        onMarkdownChange={onSummaryChange}
        onOptimize={onSummaryOptimize}
        readOnly={!isEditable(mode, status)}
        placeholder="Describe the user story, expected behavior, and acceptance criteria."
        minHeight="min-h-70"
      />
      <ActivitySection status={status} userStory={userStory} />
      <AgentFinalResponseSection
        userStory={userStory}
        onFileLinkClick={onFileLinkClick}
      />
      <CommentsSection
        codeSelectionAttachments={commentCodeSelectionAttachments}
        fileAttachments={commentFileAttachments}
        commentRef={commentRef}
        mentionDirectory={mentionDirectory}
        onFileLinkClick={onFileLinkClick}
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
        <Accordion type="multiple" className="contents">
          {agentActivities.map((activity) => (
            <AgentActivityItem key={activity.id} activity={activity} />
          ))}
        </Accordion>
      </div>
    </div>
  )
}

function AgentActivityItem({ activity }: { activity: UserStoryAgentActivity }) {
  const details = activityDetails(activity)

  return (
    <AccordionItem value={activity.id} className="border-b-0!">
      <div className="relative grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-1 text-sm">
        <span className="relative z-10 flex size-8 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm">
          <ActivityToolIcon activity={activity} toolName={details.toolName} />
        </span>
        <div className="min-w-0">
          <AccordionTrigger className="min-h-8 items-center py-0 text-muted-foreground hover:no-underline">
            <span className="truncate">{activityTitle(activity, details)}</span>
          </AccordionTrigger>
          <AccordionContent className="pt-2 pb-0">
            <ActivityDetails details={details} />
          </AccordionContent>
        </div>
      </div>
    </AccordionItem>
  )
}

function ActivityDetails({ details }: { details: ActivityDetail }) {
  const sections = activityDetailSections(details)

  if (sections.length === 0) {
    return (
      <p className="rounded-md border bg-muted/25 px-3 py-2 text-sm text-muted-foreground">
        {details.fallback}
      </p>
    )
  }

  return (
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
  )
}

function AgentFinalResponseSection({
  onFileLinkClick,
  userStory,
}: {
  onFileLinkClick?: (path: string) => void
  userStory?: UserStory
}) {
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
        onFileLinkClick={onFileLinkClick}
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
  const rawToolName = stringValue(raw.toolName)
  const rawToolCall = recordValue(raw.toolCall)
  const toolName =
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
  commentRef,
  mentionDirectory,
  onFileLinkClick,
  status,
  userStory,
}: {
  codeSelectionAttachments: PendingCodeSelectionAttachment[]
  fileAttachments?: PendingFileAttachment[]
  commentRef: React.RefObject<HTMLDivElement | null>
  mentionDirectory?: string
  onFileLinkClick?: (path: string) => void
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
