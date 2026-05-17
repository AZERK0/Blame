import * as React from "react"
import { MessageSquareIcon } from "lucide-react"

import {
  sourceCodeLines,
  useHighlightedCodeLines,
} from "@/components/backlog/development/development-highlighted-code"
import { dispatchCodeSelectionAttachment } from "@/components/backlog/shared/comment-attachment-events"
import { cn } from "@/lib/utils"

type LineSelection = {
  anchor: number
  focus: number
}

export function DevelopmentSelectableCode({
  code,
  path,
}: {
  code: string
  path: string
}) {
  const highlightedLines = useHighlightedCodeLines({ code, path })
  const sourceLines = React.useMemo(() => sourceCodeLines(code), [code])
  const [dragging, setDragging] = React.useState(false)
  const [selection, setSelection] = React.useState<LineSelection>()

  React.useEffect(() => {
    if (!dragging) return
    const stopDragging = () => setDragging(false)
    window.addEventListener("mouseup", stopDragging)
    return () => window.removeEventListener("mouseup", stopDragging)
  }, [dragging])

  const selectedRange = selectionRange(selection)
  const lines = highlightedLines ?? sourceLines

  return (
    <div className="development-code-selection min-w-full w-max py-4 font-mono text-xs leading-5">
      {lines.map((line, index) => (
        <CodeLine
          key={index}
          html={highlightedLines ? line : undefined}
          line={sourceLines[index] ?? ""}
          lineNumber={index + 1}
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
              content: sourceLines.slice(range.start - 1, range.end).join("\n"),
              endLine: range.end,
              path,
              startLine: range.start,
            })
          }}
        />
      ))}
    </div>
  )
}

function CodeLine({
  html,
  line,
  lineNumber,
  onDragLine,
  onSelectLine,
  onSendComment,
  path,
  selectedRange,
  showCommentButton,
}: {
  html?: string
  line: string
  lineNumber: number
  onDragLine: (line: number) => void
  onSelectLine: (line: number) => void
  onSendComment: (line: number) => void
  path: string
  selectedRange?: { end: number; start: number }
  showCommentButton: boolean
}) {
  const selected = Boolean(
    selectedRange && lineNumber >= selectedRange.start && lineNumber <= selectedRange.end
  )

  return (
    <div
      className={cn(
        "group/code-line grid min-w-full cursor-default select-none grid-cols-[3rem_auto] transition-colors",
        "hover:bg-black/5 dark:hover:bg-white/8",
        selected && "bg-blue-500/10 hover:bg-blue-500/15 dark:bg-blue-400/15 dark:hover:bg-blue-400/20"
      )}
      data-line={lineNumber}
      onMouseDown={(event) => {
        if (event.button !== 0) return
        onSelectLine(lineNumber)
      }}
      onMouseEnter={() => onDragLine(lineNumber)}
    >
      <div className="sticky left-0 z-10 grid h-5 grid-cols-1 items-center bg-inherit px-2">
        <span
          className={cn(
            "pointer-events-none col-start-1 row-start-1 text-right text-muted-foreground/55 transition-opacity",
            "group-hover/code-line:opacity-0",
            selectedRange && showCommentButton && "opacity-0"
          )}
        >
          {lineNumber}
        </span>
        <button
          type="button"
          aria-label={`Comment ${path} line ${lineNumber}`}
          className={cn(
            "pointer-events-none z-10 col-start-1 row-start-1 flex size-5 items-center justify-center justify-self-center rounded-md bg-blue-500 text-white opacity-0 shadow-sm transition-opacity hover:bg-blue-600",
            !selectedRange && "group-hover/code-line:pointer-events-auto group-hover/code-line:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100",
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
      </div>
      {html ? (
        <code
          className="whitespace-pre pr-4"
          dangerouslySetInnerHTML={{ __html: html || " " }}
        />
      ) : (
        <code className="whitespace-pre pr-4">{line || " "}</code>
      )}
    </div>
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
