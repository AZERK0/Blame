import * as React from "react"
import {
  BoldIcon,
  CodeIcon,
  Heading2Icon,
  ItalicIcon,
  LinkIcon,
  ListChecksIcon,
  ListIcon,
  ListOrderedIcon,
  LoaderCircleIcon,
  PaperclipIcon,
  QuoteIcon,
  Redo2Icon,
  SparklesIcon,
  StrikethroughIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  codeSelectionLineLabel,
  type PendingCodeSelectionAttachment,
} from "@/components/backlog/shared/comment-attachment-events"
import type { UserStoryFileAttachment } from "@/components/backlog/data/backlog-data"
import { DevelopmentFileIcon } from "@/components/backlog/development/development-file-icon"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { usePlatform } from "@/context/platform"
import { cn } from "@/lib/utils"

type PastedAttachment = {
  id: string
  file: File
  previewUrl?: string
  source: "code" | "file"
  subtitle?: string
  title?: string
}

export type PendingFileAttachment = {
  file: File
  id: string
}

type FileMentionState = {
  active: boolean
  query: string
  start: number
  end: number
}

type FileMentionResult = {
  path: string
  type: "directory" | "file"
}

type MarkdownPreviewBlock =
  | {
      code: string
      key: string
      type: "code"
    }
  | {
      key: string
      line: string
      lineIndex: number
      type: "line"
    }

function fileAttachments(files: File[]) {
  return files.map((file) => ({
    id: crypto.randomUUID(),
    file,
    previewUrl: file.type.startsWith("image/")
      ? URL.createObjectURL(file)
      : undefined,
    source: "file" as const,
  }))
}

function pastedAttachments(event: React.ClipboardEvent<HTMLDivElement>) {
  return fileAttachments(
    Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))
  )
}

function selectedAttachments(event: React.ChangeEvent<HTMLInputElement>) {
  return fileAttachments(
    Array.from(event.currentTarget.files ?? []).filter((file): file is File =>
      Boolean(file)
    )
  )
}

function fileMentionState(value: string, cursor: number): FileMentionState {
  const match = value.substring(0, cursor).match(/@(\S*)$/)
  return match
    ? {
        active: true,
        query: match[1] ?? "",
        start: match.index ?? cursor - match[0].length,
        end: cursor,
      }
    : { active: false, query: "", start: 0, end: cursor }
}

function markdownWithReplacement(
  value: string,
  start: number,
  end: number,
  replacement: string
) {
  return `${value.slice(0, start)}${replacement}${value.slice(end)}`
}

function markdownWithWrappedSelection(
  value: string,
  start: number,
  end: number,
  before: string,
  after = before,
  fallback = "text"
) {
  const selected = value.slice(start, end) || fallback
  return {
    cursor: start + before.length + selected.length,
    value: markdownWithReplacement(
      value,
      start,
      end,
      `${before}${selected}${after}`
    ),
  }
}

function markdownWithCodeSelection(value: string, start: number, end: number) {
  const selected = value.slice(start, end)
  if (!selected.includes("\n"))
    return markdownWithWrappedSelection(value, start, end, "`")
  const replacement = `\`\`\`\n${selected}\n\`\`\``
  return {
    cursor: start + replacement.length,
    value: markdownWithReplacement(value, start, end, replacement),
  }
}

function lineBounds(value: string, cursor: number) {
  const start = value.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1
  const nextLine = value.indexOf("\n", cursor)
  return { start, end: nextLine === -1 ? value.length : nextLine }
}

function markdownWithLinePrefix(value: string, cursor: number, prefix: string) {
  const bounds = lineBounds(value, cursor)
  const line = value.slice(bounds.start, bounds.end)
  const nextLine = line.startsWith(prefix)
    ? line.slice(prefix.length)
    : `${prefix}${line}`
  return {
    cursor: cursor + nextLine.length - line.length,
    value: markdownWithReplacement(value, bounds.start, bounds.end, nextLine),
  }
}

function markdownWithTaskPrefix(value: string, cursor: number) {
  const bounds = lineBounds(value, cursor)
  const line = value.slice(bounds.start, bounds.end)
  const task = line.match(/^- \[([ xX])\] (.*)$/)
  const nextLine = task
    ? `- [${task[1] === " " ? "x" : " "}] ${task[2]}`
    : `- [ ] ${line}`
  return {
    cursor: cursor + nextLine.length - line.length,
    value: markdownWithReplacement(value, bounds.start, bounds.end, nextLine),
  }
}

function markdownListEnterResult(value: string, cursor: number) {
  const bounds = lineBounds(value, cursor)
  const line = value.slice(bounds.start, bounds.end)
  const task = line.match(/^(\s*)- \[[ xX]\]\s(.*)$/)
  const ordered = line.match(/^(\s*)(\d+)\.\s(.*)$/)
  const unordered = line.match(/^(\s*)-\s(.*)$/)
  const prefix = listContinuationPrefix(task, ordered, unordered)
  if (!prefix) return
  const content = (task?.[2] ?? ordered?.[3] ?? unordered?.[2] ?? "").trim()
  if (!content) {
    return {
      cursor: bounds.start,
      value: markdownWithReplacement(value, bounds.start, bounds.end, ""),
    }
  }
  return {
    cursor: cursor + prefix.length + 1,
    value: markdownWithReplacement(value, cursor, cursor, `\n${prefix}`),
  }
}

function listContinuationPrefix(
  task: RegExpMatchArray | null,
  ordered: RegExpMatchArray | null,
  unordered: RegExpMatchArray | null
) {
  if (task) return `${task[1]}- [ ] `
  if (ordered) return `${ordered[1]}${Number(ordered[2]) + 1}. `
  if (unordered) return `${unordered[1]}- `
}

function markdownActionResult(
  value: string,
  start: number,
  end: number,
  action: MarkdownAction
) {
  if (action === "heading") return markdownWithLinePrefix(value, start, "## ")
  if (action === "quote") return markdownWithLinePrefix(value, start, "> ")
  if (action === "unordered") return markdownWithLinePrefix(value, start, "- ")
  if (action === "ordered") return markdownWithLinePrefix(value, start, "1. ")
  if (action === "task") return markdownWithTaskPrefix(value, start)
  if (action === "bold")
    return markdownWithWrappedSelection(value, start, end, "**")
  if (action === "italic")
    return markdownWithWrappedSelection(value, start, end, "*")
  if (action === "strike")
    return markdownWithWrappedSelection(value, start, end, "~~")
  if (action === "code") return markdownWithCodeSelection(value, start, end)
  return markdownWithWrappedSelection(
    value,
    start,
    end,
    "[",
    "](https://)",
    "link"
  )
}

function filename(path: string) {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "")
  return normalized.split("/").at(-1) || normalized
}

function markdownFileLink(path: string) {
  return `[${filename(path)}](${path})`
}

function directoryName(path: string) {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "")
  const index = normalized.lastIndexOf("/")
  return index === -1 ? "" : `${normalized.slice(0, index)}/`
}

function AttachmentDeleteButton({
  attachment,
  onRemove,
}: {
  attachment: PastedAttachment
  onRemove: (attachment: PastedAttachment) => void
}) {
  return (
    <Button
      type="button"
      aria-label={`Remove ${attachment.file.name}`}
      className="absolute -top-2 -right-2 size-6 opacity-0 shadow-sm group-hover:opacity-100 focus-visible:opacity-100"
      size="icon-xs"
      variant="destructive"
      onClick={() => onRemove(attachment)}
    >
      <Trash2Icon className="size-3" />
    </Button>
  )
}

function AttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: PastedAttachment
  onRemove?: (attachment: PastedAttachment) => void
}) {
  if (attachment.previewUrl) {
    return (
      <ImageAttachmentPreview
        attachment={{ ...attachment, previewUrl: attachment.previewUrl }}
        onRemove={onRemove}
      />
    )
  }

  return <FileAttachmentPreview attachment={attachment} onRemove={onRemove} />
}

function ImageAttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: PastedAttachment & { previewUrl: string }
  onRemove?: (attachment: PastedAttachment) => void
}) {
  return (
    <div className="group relative">
      <Dialog>
        <DialogTrigger asChild>
          <button
            type="button"
            className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border bg-muted/30 transition-colors outline-none hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <img
              alt={attachment.file.name}
              className="h-full w-full object-cover"
              src={attachment.previewUrl}
            />
          </button>
        </DialogTrigger>
        <DialogContent className="max-w-[calc(100%-2rem)] p-2 sm:max-w-4xl">
          <DialogTitle className="sr-only">{attachment.file.name}</DialogTitle>
          <img
            alt={attachment.file.name}
            className="max-h-[80vh] w-full rounded-lg object-contain"
            src={attachment.previewUrl}
          />
        </DialogContent>
      </Dialog>
      {onRemove && (
        <AttachmentDeleteButton attachment={attachment} onRemove={onRemove} />
      )}
    </div>
  )
}

function FileAttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: PastedAttachment
  onRemove?: (attachment: PastedAttachment) => void
}) {
  return (
    <div className="group relative">
      <div className="flex h-16 w-16 items-center justify-center rounded-md border bg-muted/30 px-2 text-center text-[0.625rem] leading-tight text-muted-foreground">
        <span className="line-clamp-3 break-all">
          {attachment.title ?? attachment.file.name}
          {attachment.subtitle && (
            <span className="mt-1 block text-[0.55rem] text-muted-foreground/80">
              {attachment.subtitle}
            </span>
          )}
        </span>
      </div>
      {onRemove && (
        <AttachmentDeleteButton attachment={attachment} onRemove={onRemove} />
      )}
    </div>
  )
}

type MarkdownAction =
  | "bold"
  | "code"
  | "heading"
  | "italic"
  | "link"
  | "ordered"
  | "quote"
  | "strike"
  | "task"
  | "unordered"

type MarkdownMode = "preview" | "write"

const markdownActions: {
  action: MarkdownAction
  icon: React.ComponentType<{ className?: string }>
  label: string
}[] = [
  { action: "heading", icon: Heading2Icon, label: "Heading" },
  { action: "bold", icon: BoldIcon, label: "Bold" },
  { action: "italic", icon: ItalicIcon, label: "Italic" },
  { action: "strike", icon: StrikethroughIcon, label: "Strikethrough" },
  { action: "code", icon: CodeIcon, label: "Inline code" },
  { action: "link", icon: LinkIcon, label: "Link" },
  { action: "quote", icon: QuoteIcon, label: "Quote" },
  { action: "unordered", icon: ListIcon, label: "Bullet list" },
  { action: "ordered", icon: ListOrderedIcon, label: "Numbered list" },
  { action: "task", icon: ListChecksIcon, label: "Task list" },
]

function MarkdownToolbar({
  disabled,
  onAction,
  onOptimize,
  optimizing,
  onRedo,
  onUndo,
}: {
  disabled?: boolean
  onAction: (action: MarkdownAction) => void
  onOptimize?: () => void
  optimizing?: boolean
  onRedo: () => void
  onUndo: () => void
}) {
  return (
    <TooltipProvider>
      <div className="flex flex-wrap items-center gap-1 rounded-xl border bg-popover/80 p-1 shadow-sm backdrop-blur-xl">
        <ToolbarIconButton disabled={disabled} label="Undo" onClick={onUndo}>
          <Undo2Icon className="size-4" />
        </ToolbarIconButton>
        <ToolbarIconButton disabled={disabled} label="Redo" onClick={onRedo}>
          <Redo2Icon className="size-4" />
        </ToolbarIconButton>
        <ToolbarSeparator />
        {markdownActions.map(({ action, icon: Icon, label }) => (
          <React.Fragment key={action}>
            {action === "unordered" && <ToolbarSeparator />}
            <ToolbarIconButton
              disabled={disabled}
              label={label}
              onClick={() => onAction(action)}
            >
              <Icon className="size-4" />
            </ToolbarIconButton>
          </React.Fragment>
        ))}
        {onOptimize && (
          <>
            <ToolbarSeparator />
            <Tooltip delayDuration={1000}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  aria-label="Optimize with AI"
                  className="h-7 gap-1.5 rounded-lg border-primary/20 bg-gradient-to-r from-primary to-sky-500 px-2.5 text-xs text-primary-foreground shadow-sm shadow-primary/20 hover:from-primary/90 hover:to-sky-500/90"
                  disabled={disabled}
                  onClick={onOptimize}
                >
                  {optimizing ? (
                    <LoaderCircleIcon className="size-3.5 animate-spin" />
                  ) : (
                    <SparklesIcon className="size-3.5" />
                  )}
                  Optimize with AI
                </Button>
              </TooltipTrigger>
              <TooltipContent sideOffset={6}>
                Rewrite this user story into a clearer, structured prompt.
              </TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </TooltipProvider>
  )
}

function ToolbarSeparator() {
  return <Separator className="mx-1 h-5 !self-center" orientation="vertical" />
}

function ToolbarIconButton({
  children,
  disabled,
  label,
  onClick,
}: {
  children: React.ReactNode
  disabled?: boolean
  label: string
  onClick?: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          aria-label={label}
          disabled={disabled || !onClick}
          size="icon-sm"
          variant="ghost"
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  )
}

function MarkdownPreview({
  className,
  markdown,
  onFileLinkClick,
  onTaskToggle,
  placeholder,
}: {
  className?: string
  markdown: string
  onFileLinkClick?: (path: string) => void
  onTaskToggle?: (lineIndex: number, checked: boolean) => void
  placeholder: string
}) {
  const blocks = markdownPreviewBlocks(markdown)
  if (!markdown.trim()) {
    return (
      <div className={cn("text-sm text-muted-foreground", className)}>
        {placeholder}
      </div>
    )
  }
  return (
    <div className={cn("space-y-2 text-sm leading-6", className)}>
      {blocks.map((block) =>
        block.type === "code" ? (
          <MarkdownPreviewCode key={block.key} code={block.code} />
        ) : (
          <MarkdownPreviewLine
            key={block.key}
            line={block.line}
            lineIndex={block.lineIndex}
            onFileLinkClick={onFileLinkClick}
            onTaskToggle={onTaskToggle}
          />
        )
      )}
    </div>
  )
}

function markdownPreviewBlocks(markdown: string) {
  const blocks: MarkdownPreviewBlock[] = []
  const lines = markdown.split("\n")
  let codeStart: number | undefined
  let codeLines: string[] = []

  lines.forEach((line, index) => {
    if (line.startsWith("```")) {
      if (codeStart === undefined) {
        codeStart = index
        codeLines = []
        return
      }
      blocks.push({
        code: codeLines.join("\n"),
        key: `code-${codeStart}`,
        type: "code",
      })
      codeStart = undefined
      codeLines = []
      return
    }

    if (codeStart !== undefined) {
      codeLines.push(line)
      return
    }

    blocks.push({
      key: `line-${index}-${line}`,
      line,
      lineIndex: index,
      type: "line",
    })
  })

  if (codeStart !== undefined) {
    blocks.push({
      code: codeLines.join("\n"),
      key: `code-${codeStart}`,
      type: "code",
    })
  }

  return blocks
}

function MarkdownPreviewCode({ code }: { code: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border bg-muted/50 px-3 py-2 font-mono text-xs leading-relaxed text-foreground">
      <code>{code}</code>
    </pre>
  )
}

function MarkdownPreviewLine({
  line,
  lineIndex,
  onFileLinkClick,
  onTaskToggle,
}: {
  line: string
  lineIndex: number
  onFileLinkClick?: (path: string) => void
  onTaskToggle?: (lineIndex: number, checked: boolean) => void
}) {
  if (!line.trim()) return <div className="h-3" />
  if (/^\s*---+\s*$/.test(line)) return <hr className="border-border" />
  const task = line.match(/^- \[([ xX])\] (.*)$/)
  if (task) {
    const checked = task[1].toLowerCase() === "x"
    return (
      <label className="flex items-start gap-2 pl-1">
        <Checkbox
          checked={checked}
          className="mt-1"
          disabled={!onTaskToggle}
          onCheckedChange={(nextChecked) =>
            onTaskToggle?.(lineIndex, nextChecked === true)
          }
        />
        <span className={cn(checked && "line-through")}>
          {inlineMarkdown(task[2], onFileLinkClick)}
        </span>
      </label>
    )
  }
  const heading = line.match(/^(#{1,6})\s(.+)$/)
  if (heading)
    return (
      <MarkdownPreviewHeading
        level={heading[1].length}
        text={heading[2]}
        onFileLinkClick={onFileLinkClick}
      />
    )
  if (line.startsWith("> ")) {
    return (
      <blockquote className="border-l-2 pl-3 text-muted-foreground">
        {inlineMarkdown(line.slice(2), onFileLinkClick)}
      </blockquote>
    )
  }
  if (/^\d+\.\s/.test(line))
    return <p className="pl-4">{inlineMarkdown(line, onFileLinkClick)}</p>
  if (line.startsWith("- "))
    return (
      <p className="pl-4">
        {inlineMarkdown(`• ${line.slice(2)}`, onFileLinkClick)}
      </p>
    )
  return <p>{inlineMarkdown(line, onFileLinkClick)}</p>
}

function MarkdownPreviewHeading({
  level,
  onFileLinkClick,
  text,
}: {
  level: number
  onFileLinkClick?: (path: string) => void
  text: string
}) {
  const content = inlineMarkdown(text, onFileLinkClick)
  if (level === 1) return <h1 className="text-xl font-semibold">{content}</h1>
  if (level === 2) return <h2 className="text-lg font-semibold">{content}</h2>
  if (level === 3) return <h3 className="text-base font-semibold">{content}</h3>
  return <h4 className="font-semibold">{content}</h4>
}

function inlineMarkdown(
  value: string,
  onFileLinkClick?: (path: string) => void
) {
  const tokens = value.split(
    /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/g
  )
  return tokens.map((token, index) =>
    inlineMarkdownToken(token, index, onFileLinkClick)
  )
}

function inlineMarkdownToken(
  token: string,
  index: number,
  onFileLinkClick?: (path: string) => void
) {
  if (token.startsWith("**") && token.endsWith("**"))
    return <strong key={index}>{token.slice(2, -2)}</strong>
  if (token.startsWith("*") && token.endsWith("*"))
    return <em key={index}>{token.slice(1, -1)}</em>
  if (token.startsWith("~~") && token.endsWith("~~"))
    return <s key={index}>{token.slice(2, -2)}</s>
  if (token.startsWith("`") && token.endsWith("`")) {
    return (
      <code key={index} className="rounded bg-muted px-1 py-0.5 text-xs">
        {token.slice(1, -1)}
      </code>
    )
  }
  const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
  if (link) return markdownLinkToken(link[1], link[2], index, onFileLinkClick)
  return <React.Fragment key={index}>{markdownArrowText(token)}</React.Fragment>
}

function markdownArrowText(value: string) {
  return value.replace(/=>|->/g, "➔")
}

function markdownLinkToken(
  label: string,
  href: string,
  index: number,
  onFileLinkClick?: (path: string) => void
) {
  const fileLink = isFileLink(href)
  return (
    <a
      key={index}
      className="inline-flex items-center gap-1 text-blue-600 underline underline-offset-2 dark:text-blue-400"
      href={href}
      onClick={(event) => {
        if (!fileLink) return
        event.preventDefault()
        onFileLinkClick?.(href)
      }}
    >
      {fileLink && (
        <DevelopmentFileIcon
          className="size-3.5 shrink-0 text-blue-600 dark:text-blue-400"
          mono
          node={{ name: filename(href), path: href, type: "file" }}
        />
      )}
      {label}
    </a>
  )
}

function isFileLink(href: string) {
  if (/^[a-z][a-z\d+.-]*:/i.test(href)) return false
  if (href.startsWith("#") || href.startsWith("/")) return false
  return href.includes("/") || /\.[^./\s]+$/.test(href)
}

export const MarkdownEditor = React.forwardRef<
  HTMLDivElement,
  {
    markdown: string
    minHeight: string
    placeholder: string
    codeSelectionAttachments?: PendingCodeSelectionAttachment[]
    fileAttachments?: PendingFileAttachment[]
    mentionDirectory?: string
    onCodeSelectionAttachmentRemove?: (id: string) => void
    onFileAttachmentRemove?: (id: string) => void
    onFileAttachmentsAdd?: (attachments: UserStoryFileAttachment[]) => void
    onFileLinkClick?: (path: string) => void
    onMarkdownChange?: (markdown: string) => void
    onOptimize?: (markdown: string) => Promise<string>
    readOnly?: boolean
  }
>(function MarkdownEditor(
  {
    codeSelectionAttachments,
    fileAttachments,
    markdown,
    mentionDirectory,
    minHeight,
    onCodeSelectionAttachmentRemove,
    onFileAttachmentRemove,
    onFileAttachmentsAdd,
    onFileLinkClick,
    onMarkdownChange,
    onOptimize,
    placeholder,
    readOnly,
  },
  ref
) {
  const platform = usePlatform()
  const [attachments, setAttachments] = React.useState<PastedAttachment[]>([])
  const [mention, setMention] = React.useState<FileMentionState>({
    active: false,
    query: "",
    start: 0,
    end: 0,
  })
  const [mentionResults, setMentionResults] = React.useState<
    FileMentionResult[]
  >([])
  const [activeMentionIndex, setActiveMentionIndex] = React.useState(0)
  const attachmentsRef = React.useRef<PastedAttachment[]>([])
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const handledCodeSelectionIdsRef = React.useRef(new Set<string>())
  const handledFileAttachmentIdsRef = React.useRef(new Set<string>())
  const mentionSearchRef = React.useRef(0)
  const pendingSelectionRef = React.useRef<number | null>(null)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const [draftMarkdown, setDraftMarkdown] = React.useState(markdown)
  const [optimizing, setOptimizing] = React.useState(false)
  const [mode, setMode] = React.useState<MarkdownMode>("write")
  const value = readOnly || onMarkdownChange ? markdown : draftMarkdown
  const mentionOpen =
    mention.active && Boolean(mentionDirectory && platform.workspace)

  React.useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  React.useEffect(() => {
    if (!mentionOpen) return

    const search = ++mentionSearchRef.current
    const timer = setTimeout(async () => {
      try {
        if (search !== mentionSearchRef.current) return
        if (!mentionDirectory || !platform.workspace) return
        const results = await platform.workspace.searchFiles({
          root: mentionDirectory,
          query: mention.query,
          limit: 20,
        })
        if (search !== mentionSearchRef.current) return
        setMentionResults(results)
        setActiveMentionIndex(0)
      } catch {
        if (search !== mentionSearchRef.current) return
        setMentionResults([])
        setActiveMentionIndex(0)
      }
    }, 80)

    return () => clearTimeout(timer)
  }, [mention.query, mentionDirectory, mentionOpen, platform.workspace])

  React.useEffect(() => {
    if (mentionOpen) return
    mentionSearchRef.current += 1
  }, [mentionOpen])

  React.useEffect(
    () => () => {
      attachmentsRef.current.forEach((attachment) => {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
      })
    },
    []
  )

  React.useLayoutEffect(() => {
    const cursor = pendingSelectionRef.current
    if (cursor === null) return
    pendingSelectionRef.current = null
    textareaRef.current?.setSelectionRange(cursor, cursor)
    textareaRef.current?.focus()
  }, [value])

  const updateMention = React.useCallback(
    (nextValue = value) => {
      const textarea = textareaRef.current
      if (!textarea || readOnly || !mentionDirectory) {
        setMention((current) =>
          current.active
            ? { active: false, query: "", start: 0, end: 0 }
            : current
        )
        return
      }
      setMention(fileMentionState(nextValue, textarea.selectionStart))
    },
    [mentionDirectory, readOnly, value]
  )

  const emitMarkdown = React.useCallback(
    (nextMarkdown: string, cursor?: number) => {
      if (!onMarkdownChange) setDraftMarkdown(nextMarkdown)
      onMarkdownChange?.(nextMarkdown)
      if (cursor !== undefined) pendingSelectionRef.current = cursor
      requestAnimationFrame(() => updateMention(nextMarkdown))
    },
    [onMarkdownChange, updateMention]
  )

  React.useEffect(() => {
    const nextAttachments = (codeSelectionAttachments ?? []).filter(
      (attachment) => !handledCodeSelectionIdsRef.current.has(attachment.id)
    )
    if (nextAttachments.length === 0) return
    codeSelectionAttachments?.forEach((attachment) => {
      handledCodeSelectionIdsRef.current.add(attachment.id)
    })
    addAttachments(nextAttachments.map(codeSelectionAttachment))
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [codeSelectionAttachments])

  React.useEffect(() => {
    const nextAttachments = (fileAttachments ?? [])
      .filter(
        (attachment) => !handledFileAttachmentIdsRef.current.has(attachment.id)
      )
      .map(pendingFileAttachment)
    if (nextAttachments.length === 0) return
    fileAttachments?.forEach((attachment) => {
      handledFileAttachmentIdsRef.current.add(attachment.id)
    })
    addAttachments(nextAttachments)
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [fileAttachments])

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!mentionOpen) return
    if (event.key === "Escape") {
      closeMention()
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.key === "ArrowDown") {
      setActiveMentionIndex((index) =>
        mentionResults.length === 0 ? 0 : (index + 1) % mentionResults.length
      )
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.key === "ArrowUp") {
      setActiveMentionIndex((index) =>
        mentionResults.length === 0
          ? 0
          : (index - 1 + mentionResults.length) % mentionResults.length
      )
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.key === "Enter" || event.key === "Tab") {
      selectMention(mentionResults[activeMentionIndex])
      event.preventDefault()
      event.stopPropagation()
    }
  }

  function closeMention() {
    setMention({ active: false, query: "", start: 0, end: 0 })
    setMentionResults([])
    setActiveMentionIndex(0)
  }

  function selectMention(result?: FileMentionResult) {
    if (!result) return
    const insertedPath =
      result.type === "file"
        ? `${markdownFileLink(result.path)} `
        : `${result.path} `
    const nextMarkdown = markdownWithReplacement(
      value,
      mention.start,
      mention.end,
      insertedPath
    )
    closeMention()
    emitMarkdown(nextMarkdown, mention.start + insertedPath.length)
  }

  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    if (readOnly) return
    const nextAttachments = pastedAttachments(event)
    if (nextAttachments.length === 0) return
    void addFileAttachments(nextAttachments)
  }

  function handleFileSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const nextAttachments = selectedAttachments(event)
    event.currentTarget.value = ""
    if (nextAttachments.length === 0) return
    void addFileAttachments(nextAttachments)
  }

  async function addFileAttachments(nextAttachments: PastedAttachment[]) {
    addAttachments(nextAttachments)
    if (!onFileAttachmentsAdd) {
      return
    }
    nextAttachments.forEach((attachment) => {
      handledFileAttachmentIdsRef.current.add(attachment.id)
    })
    onFileAttachmentsAdd(
      await Promise.all(nextAttachments.map(persistentFileAttachment))
    )
  }

  function addAttachments(nextAttachments: PastedAttachment[]) {
    setAttachments((currentAttachments) => [
      ...currentAttachments,
      ...nextAttachments,
    ])
  }

  function removeAttachment(attachment: PastedAttachment) {
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
    if (attachment.source === "code")
      onCodeSelectionAttachmentRemove?.(attachment.id)
    if (attachment.source === "file") onFileAttachmentRemove?.(attachment.id)
    setAttachments((currentAttachments) =>
      currentAttachments.filter(
        (currentAttachment) => currentAttachment.id !== attachment.id
      )
    )
  }

  function handleMarkdownChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    emitMarkdown(event.currentTarget.value)
  }

  function handleTextareaKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    )
      return
    const textarea = event.currentTarget
    if (textarea.selectionStart !== textarea.selectionEnd) return
    const result = markdownListEnterResult(value, textarea.selectionStart)
    if (!result) return
    event.preventDefault()
    emitMarkdown(result.value, result.cursor)
  }

  function applyMarkdownAction(action: MarkdownAction) {
    const textarea = textareaRef.current
    if (!textarea || readOnly) return
    const result = markdownActionResult(
      value,
      textarea.selectionStart,
      textarea.selectionEnd,
      action
    )
    emitMarkdown(result.value, result.cursor)
  }

  function toggleTaskLine(lineIndex: number, checked: boolean) {
    const lines = value.split("\n")
    const line = lines[lineIndex]
    if (line === undefined) return
    lines[lineIndex] = line.replace(
      /^- \[[ xX]\]/,
      `- [${checked ? "x" : " "}]`
    )
    emitMarkdown(lines.join("\n"))
  }

  function runHistoryCommand(command: "redo" | "undo") {
    textareaRef.current?.focus()
    document.execCommand(command)
  }

  async function handleOptimize() {
    if (!onOptimize || readOnly || optimizing) return
    setOptimizing(true)
    try {
      emitMarkdown(await onOptimize(value))
    } finally {
      setOptimizing(false)
    }
  }

  return (
    <Popover open={mentionOpen}>
      <PopoverAnchor asChild>
        <div
          ref={(element) => {
            rootRef.current = element
            if (typeof ref === "function") ref(element)
            else if (ref) ref.current = element
          }}
          className="rounded-2xl border border-border/80 bg-background/70 p-2 shadow-lg shadow-foreground/5 backdrop-blur-xl transition-colors focus-within:border-ring dark:bg-input/20"
          onBlur={() => requestAnimationFrame(() => updateMention())}
          onKeyDownCapture={handleKeyDown}
          onPaste={handlePaste}
        >
          {readOnly ? (
            <MarkdownPreview
              className={cn(minHeight, "rounded-xl px-3 py-3")}
              markdown={value}
              onFileLinkClick={onFileLinkClick}
              onTaskToggle={readOnly ? undefined : toggleTaskLine}
              placeholder={placeholder}
            />
          ) : (
            <Tabs
              className="gap-2"
              value={mode}
              onValueChange={(nextMode) => setMode(nextMode as MarkdownMode)}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <TabsList className="rounded-xl bg-muted/60 p-1">
                  <TabsTrigger className="px-4" value="write">
                    Write
                  </TabsTrigger>
                  <TabsTrigger className="px-4" value="preview">
                    Preview
                  </TabsTrigger>
                </TabsList>
                <MarkdownToolbar
                  disabled={readOnly || mode === "preview" || optimizing}
                  onAction={applyMarkdownAction}
                  onOptimize={onOptimize ? handleOptimize : undefined}
                  optimizing={optimizing}
                  onRedo={() => runHistoryCommand("redo")}
                  onUndo={() => runHistoryCommand("undo")}
                />
              </div>
              <TabsContent className="mt-0" value="write">
                <Textarea
                  ref={textareaRef}
                  data-markdown-editor-input="true"
                  className={cn(
                    minHeight,
                    "resize-y rounded-xl border-border/80 bg-background/70 px-3 py-3 text-sm shadow-inner shadow-foreground/3 focus-visible:border-border/80 focus-visible:ring-0 dark:bg-background/20"
                  )}
                  placeholder={placeholder}
                  value={value}
                  onChange={handleMarkdownChange}
                  onClick={() => updateMention()}
                  onKeyDown={handleTextareaKeyDown}
                  onKeyUp={() => updateMention()}
                  onSelect={() => updateMention()}
                />
              </TabsContent>
              <TabsContent className="mt-0" value="preview">
                <MarkdownPreview
                  className={cn(
                    minHeight,
                    "rounded-xl border border-border/80 bg-background/70 px-3 py-3 shadow-inner shadow-foreground/3 dark:bg-background/20"
                  )}
                  markdown={value}
                  onFileLinkClick={onFileLinkClick}
                  onTaskToggle={toggleTaskLine}
                  placeholder={placeholder}
                />
              </TabsContent>
            </Tabs>
          )}

          <div className="flex flex-wrap items-center gap-3 px-2 pt-3 pb-1">
            {attachments.map((attachment) => (
              <AttachmentPreview
                key={attachment.id}
                attachment={attachment}
                onRemove={readOnly ? undefined : removeAttachment}
              />
            ))}
            {!readOnly && (
              <>
                <input
                  ref={fileInputRef}
                  className="hidden"
                  multiple
                  type="file"
                  onChange={handleFileSelection}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="flex h-16 w-16 flex-col gap-2 rounded-xl border-dashed bg-background/70 p-5 shadow-sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <PaperclipIcon className="size-5" />
                </Button>
              </>
            )}
          </div>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[min(36rem,calc(100vw-2rem))] p-0"
        onCloseAutoFocus={(event) => event.preventDefault()}
        onMouseDown={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => event.preventDefault()}
        side="top"
        sideOffset={8}
      >
        <Command shouldFilter={false}>
          <CommandList className="max-h-72">
            <CommandEmpty className="py-3 text-muted-foreground">
              No matching files.
            </CommandEmpty>
            <CommandGroup>
              {mentionResults.map((result, index) => (
                <CommandItem
                  key={result.path}
                  value={result.path}
                  className={`gap-2 ${index === activeMentionIndex ? "bg-muted text-foreground" : ""}`}
                  onMouseEnter={() => setActiveMentionIndex(index)}
                  onSelect={() => selectMention(result)}
                >
                  <DevelopmentFileIcon className="shrink-0" node={result} />
                  <span className="flex min-w-0 items-center text-sm">
                    <span className="truncate text-muted-foreground">
                      {directoryName(result.path)}
                    </span>
                    <span className="shrink-0 text-foreground">
                      {filename(result.path)}
                      {result.type === "directory" ? "/" : ""}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
})

function codeSelectionAttachment(
  attachment: PendingCodeSelectionAttachment
): PastedAttachment {
  return {
    id: attachment.id,
    file: new File([attachment.content], attachment.path, {
      type: "text/plain",
    }),
    source: "code",
    subtitle: codeSelectionLineLabel(attachment),
    title: attachment.path,
  }
}

function pendingFileAttachment(
  attachment: PendingFileAttachment
): PastedAttachment {
  return {
    id: attachment.id,
    file: attachment.file,
    previewUrl: attachment.file.type.startsWith("image/")
      ? URL.createObjectURL(attachment.file)
      : undefined,
    source: "file",
  }
}

async function persistentFileAttachment(
  attachment: PastedAttachment
): Promise<UserStoryFileAttachment> {
  return {
    id: attachment.id,
    content: await fileContent(attachment.file),
    name: attachment.file.name,
    size: attachment.file.size,
    type: attachment.file.type,
  }
}

function fileContent(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener("load", () => {
      const value = typeof reader.result === "string" ? reader.result : ""
      resolve(value.split(",", 2)[1] ?? "")
    })
    reader.addEventListener("error", () => reject(reader.error))
    reader.readAsDataURL(file)
  })
}
