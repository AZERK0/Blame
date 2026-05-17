import * as React from "react"
import type { VcsFileDiff } from "@/components/backlog/development/development-workspace"
import { MessageSquareIcon } from "lucide-react"

import { DevelopmentScrollArea } from "@/components/backlog/development/development-scroll-area"
import {
  diffKindClassName,
  filename,
} from "@/components/backlog/development/development-workspace"
import { dispatchCodeSelectionAttachment } from "@/components/backlog/shared/comment-attachment-events"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type LineSelection = {
  anchor: number
  focus: number
}

type DiffCodeLine = {
  content: string
  newLineNumber?: number
  oldLineNumber?: number
}

export function DevelopmentDiffView({
  diff,
  scroll = true,
  title,
}: {
  diff?: VcsFileDiff
  scroll?: boolean
  title?: string
}) {
  if (!diff?.patch) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
        No diff available.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden">
      {title && (
        <div className="flex min-w-0 shrink-0 items-center gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur">
          <span className="truncate font-medium">{title}</span>
          <DiffStats diff={diff} />
        </div>
      )}
      {scroll ? (
        <DevelopmentScrollArea className="min-h-0 w-full max-w-full flex-1">
          <DiffCode patch={diff.patch} path={diff.file} />
        </DevelopmentScrollArea>
      ) : (
        <DiffCode patch={diff.patch} path={diff.file} />
      )}
    </div>
  )
}

export function DiffStats({ diff }: { diff: VcsFileDiff }) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1">
      <Badge className="h-5 border-emerald-500/30 bg-emerald-500/10 px-1.5 text-emerald-600 dark:text-emerald-400" variant="outline">
        +{diff.additions ?? 0}
      </Badge>
      <Badge className="h-5 border-destructive/30 bg-destructive/10 px-1.5 text-destructive" variant="outline">
        -{diff.deletions ?? 0}
      </Badge>
    </span>
  )
}

export function DiffFileHeader({ diff }: { diff: VcsFileDiff }) {
  const kind = diff.status === "added" ? "add" : diff.status === "deleted" ? "del" : "mix"

  return (
    <div className="flex min-w-0 items-center gap-2 border-b bg-muted/30 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{filename(diff.file)}</div>
        <div className="truncate text-xs text-muted-foreground">{diff.file}</div>
      </div>
      <Badge className={cn("shrink-0", diffKindClassName(kind))} variant="outline">
        {diff.status ?? "modified"}
      </Badge>
      <DiffStats diff={diff} />
    </div>
  )
}

function DiffLine({
  line,
  lineNumber,
  newLineNumber,
  oldLineNumber,
  onDragLine,
  onSelectLine,
  onSendComment,
  path,
  selectedRange,
  showCommentButton,
}: {
  line: string
  lineNumber: number
  newLineNumber?: number
  oldLineNumber?: number
  onDragLine: (line: number) => void
  onSelectLine: (line: number) => void
  onSendComment: (line: number) => void
  path: string
  selectedRange?: { end: number; start: number }
  showCommentButton: boolean
}) {
  const kind = lineKind(line)
  const selected = Boolean(
    selectedRange && lineNumber >= selectedRange.start && lineNumber <= selectedRange.end
  )

  return (
    <div
      className={cn(
        "group/diff-line grid min-w-full cursor-default select-none grid-cols-[3rem_2.75rem_1.5rem_max-content] border-l-2 transition-colors",
        lineClassName(kind),
        "hover:bg-black/5 dark:hover:bg-white/8",
        selected && "bg-blue-500/10 hover:bg-blue-500/15 dark:bg-blue-400/15 dark:hover:bg-blue-400/20"
      )}
      onMouseDown={(event) => {
        if (event.button !== 0) return
        onSelectLine(lineNumber)
      }}
      onMouseEnter={() => onDragLine(lineNumber)}
    >
      <span className="sticky left-0 z-10 grid h-5 grid-cols-1 items-center bg-inherit px-1.5">
        <span
          className={cn(
            "pointer-events-none col-start-1 row-start-1 text-right text-muted-foreground/70 transition-opacity",
            "group-hover/diff-line:opacity-0",
            selectedRange && showCommentButton && "opacity-0"
          )}
        >
          {oldLineNumber ?? newLineNumber ?? ""}
        </span>
        <button
          type="button"
          aria-label={`Comment ${path} diff line ${lineNumber}`}
          className={cn(
            "pointer-events-none z-10 col-start-1 row-start-1 flex size-5 items-center justify-center justify-self-center rounded-md bg-blue-500 text-white opacity-0 shadow-sm transition-opacity hover:bg-blue-600",
            !selectedRange && "group-hover/diff-line:pointer-events-auto group-hover/diff-line:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100",
            selectedRange && showCommentButton && "pointer-events-auto opacity-100 focus-visible:opacity-100",
            selectedRange && !showCommentButton && "pointer-events-none invisible"
          )}
          onClick={(event) => {
            event.stopPropagation()
            onSendComment(lineNumber)
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <MessageSquareIcon className="size-3" />
        </button>
      </span>
      <span className="select-none px-1.5 text-right text-muted-foreground/70">
        {newLineNumber ?? ""}
      </span>
      <span className="select-none px-1 text-center text-muted-foreground/70">
        {diffMarker(line)}
      </span>
      <code className="whitespace-pre px-3">{diffLineContent(line) || " "}</code>
    </div>
  )
}

function DiffCode({ patch, path }: { patch: string; path: string }) {
  const lines = React.useMemo(() => diffLines(patch), [patch])
  const [dragging, setDragging] = React.useState(false)
  const [selection, setSelection] = React.useState<LineSelection>()
  const selectedRange = selectionRange(selection)

  React.useEffect(() => {
    if (!dragging) return
    const stopDragging = () => setDragging(false)
    window.addEventListener("mouseup", stopDragging)
    return () => window.removeEventListener("mouseup", stopDragging)
  }, [dragging])

  return (
    <pre className="w-max min-w-full p-0 font-mono text-xs leading-5">
      {lines.map((line, index) => (
        <DiffLine
          key={`${index}:${line.content}`}
          line={line.content}
          lineNumber={index + 1}
          newLineNumber={line.newLineNumber}
          oldLineNumber={line.oldLineNumber}
          path={path}
          selectedRange={selectedRange}
          showCommentButton={showCommentButton(selectedRange, index + 1)}
          onDragLine={(lineNumber) => {
            if (!dragging || !selection) return
            setSelection({ ...selection, focus: lineNumber })
          }}
          onSelectLine={(lineNumber) => {
            setDragging(true)
            setSelection({ anchor: lineNumber, focus: lineNumber })
          }}
          onSendComment={(lineNumber) => {
            const range = selectedLineRange(selectedRange, lineNumber)
            dispatchCodeSelectionAttachment({
              content: lines.slice(range.start - 1, range.end).map((line) => line.content).join("\n"),
              endLine: range.end,
              path,
              startLine: range.start,
            })
          }}
        />
      ))}
    </pre>
  )
}

function showCommentButton(
  selectedRange: { end: number; start: number } | undefined,
  lineNumber: number
) {
  if (!selectedRange) return true
  return lineNumber === selectedRange.start
}

function selectionRange(selection?: LineSelection) {
  if (!selection) return undefined
  return {
    end: Math.max(selection.anchor, selection.focus),
    start: Math.min(selection.anchor, selection.focus),
  }
}

function selectedLineRange(
  selectedRange: { end: number; start: number } | undefined,
  lineNumber: number
) {
  if (!selectedRange) return { end: lineNumber, start: lineNumber }
  if (lineNumber < selectedRange.start || lineNumber > selectedRange.end) {
    return { end: lineNumber, start: lineNumber }
  }
  return selectedRange
}

function lineKind(line: string) {
  if (line.startsWith("@@")) return "hunk"
  if (line.startsWith("+++") || line.startsWith("---")) return "meta"
  if (line.startsWith("+")) return "add"
  if (line.startsWith("-")) return "del"
  if (line.startsWith("diff ") || line.startsWith("index ")) return "meta"
  return "context"
}

function lineClassName(kind: ReturnType<typeof lineKind>) {
  if (kind === "add") return "border-emerald-500/50 bg-emerald-500/10"
  if (kind === "del") return "border-destructive/50 bg-destructive/10"
  if (kind === "hunk") return "border-primary/40 bg-primary/10 text-primary"
  if (kind === "meta") return "border-border bg-muted/60 text-muted-foreground"
  return "border-transparent"
}

function diffMarker(line: string) {
  if (line.startsWith("@@")) return "@@"
  if (line.startsWith("+") && !line.startsWith("+++")) return "+"
  if (line.startsWith("-") && !line.startsWith("---")) return "-"
  return ""
}

function diffLineContent(line: string) {
  if (line.startsWith("+") && !line.startsWith("+++")) return ` ${line.slice(1)}`
  if (line.startsWith("-") && !line.startsWith("---")) return ` ${line.slice(1)}`
  return line
}

function diffLines(patch: string): DiffCodeLine[] {
  let oldLineNumber = 0
  let newLineNumber = 0

  return patch.split("\n").map((content) => {
    const hunk = hunkLineNumbers(content)
    if (hunk) {
      oldLineNumber = hunk.oldStart
      newLineNumber = hunk.newStart
      return { content }
    }

    if (lineKind(content) === "meta") return { content }

    if (content.startsWith("-")) {
      const line = { content, oldLineNumber }
      oldLineNumber += 1
      return line
    }

    if (content.startsWith("+")) {
      const line = { content, newLineNumber }
      newLineNumber += 1
      return line
    }

    const line = { content, oldLineNumber, newLineNumber }
    oldLineNumber += 1
    newLineNumber += 1
    return line
  })
}

function hunkLineNumbers(line: string) {
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
  if (!match) return undefined
  return {
    newStart: Number(match[2]),
    oldStart: Number(match[1]),
  }
}
