import * as React from "react"
import { File as PierreFile } from "@pierre/diffs/react"
import { FileIcon, MessageSquareIcon } from "lucide-react"

import { DevelopmentDiffView } from "@/components/backlog/development/development-diff-view"
import { DevelopmentScrollArea } from "@/components/backlog/development/development-scroll-area"
import type { FileContent, VcsFileDiff } from "@/components/backlog/development/development-workspace"
import {
  filename,
  parseGitDiff,
} from "@/components/backlog/development/development-workspace"
import { dispatchCodeSelectionAttachment } from "@/components/backlog/shared/comment-attachment-events"
import { Skeleton } from "@/components/ui/skeleton"
import { useTheme } from "@/components/providers/theme-provider"

type FileState = {
  path: string
  content?: FileContent
  error?: string
}

export function DevelopmentFileView({
  diff,
  path,
  readFile,
  reloadKey,
}: {
  diff?: VcsFileDiff
  path: string
  readFile: (path: string) => Promise<FileContent | undefined>
  reloadKey: number
}) {
  const [state, setState] = React.useState<FileState>()

  React.useEffect(() => {
    let cancelled = false
    readFile(path)
      .then((content) => {
        if (!cancelled) setState({ content, path })
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            error: error instanceof Error ? error.message : "Unable to read file",
            path,
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [path, readFile, reloadKey])

  if (!state || state.path !== path) return <FileSkeleton />

  if (state.error) {
    return (
      <EmptyFileState
        description={state.error}
        title="Unable to open file"
      />
    )
  }

  if (!state.content) {
    return (
      <EmptyFileState
        description="This file cannot be previewed as text."
        title="Binary file"
      />
    )
  }

  if (isImageContent(state.content)) {
    return <ImagePreview content={state.content} path={path} />
  }

  if (state.content.type === "binary") {
    return (
      <EmptyFileState
        description="This file cannot be previewed."
        title="Binary file"
      />
    )
  }

  const previewDiff = diff ?? contentDiff(path, state.content)

  if (!previewDiff) {
    return <FileSource path={path} source={sourceText(state.content)} />
  }

  return (
    <div className="grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] overflow-hidden">
      <div className="min-h-0 min-w-0 overflow-hidden">
        <FileSource path={path} source={sourceText(state.content)} />
      </div>
      <div className="min-h-0 min-w-0 overflow-hidden border-t">
        <DevelopmentDiffView diff={previewDiff} title="Changes" />
      </div>
    </div>
  )
}

function FileSource({ path, source }: { path: string; source: string }) {
  const { theme } = useTheme()
  const sourceLines = React.useMemo(() => source.split("\n"), [source])
  const selectedRange = React.useRef<
    { end: number; start: number } | undefined
  >(undefined)
  const commentSelection = React.useCallback(
    (range: { end: number; start: number }) => {
      const start = Math.max(1, range.start)
      const end = Math.min(sourceLines.length, Math.max(start, range.end))
      dispatchCodeSelectionAttachment({
        content: sourceLines.slice(start - 1, end).join("\n"),
        endLine: end,
        path,
        startLine: start,
      })
    },
    [path, sourceLines]
  )
  const rememberSelectedRange = React.useCallback(
    (range: { end: number; start: number } | null) => {
      selectedRange.current = range ?? undefined
    },
    []
  )
  const themeType =
    theme === "system"
      ? document.documentElement.classList.contains("dark")
        ? "dark"
        : "light"
      : theme
  const options = React.useMemo(
    () => ({
      disableFileHeader: true,
      enableGutterUtility: true,
      enableLineSelection: true,
      lineHoverHighlight: "line" as const,
      onLineSelectionEnd: rememberSelectedRange,
      overflow: "scroll" as const,
      theme: { dark: "github-dark" as const, light: "github-light" as const },
      themeType,
    }),
    [rememberSelectedRange, themeType]
  )

  return (
    <div className="flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden">
      <FileHeader path={path} />
      <DevelopmentScrollArea className="min-h-0 w-full max-w-full flex-1">
        <PierreFile
          className="blame-pierre-file"
          file={{ contents: source, name: path }}
          options={options}
          renderGutterUtility={(getHoveredLine) => (
            <button
              aria-label={`Comment ${path} source selection`}
              className="blame-pierre-gutter-button"
              data-utility-button=""
              onClick={() => {
                const hoveredLine = getHoveredLine()
                const range =
                  selectedRange.current ??
                  (hoveredLine
                    ? {
                        end: hoveredLine.lineNumber,
                        start: hoveredLine.lineNumber,
                      }
                    : undefined)
                if (range) commentSelection(range)
              }}
              type="button"
            >
              <MessageSquareIcon size={13} />
            </button>
          )}
        />
      </DevelopmentScrollArea>
    </div>
  )
}

function ImagePreview({
  content,
  path,
}: {
  content: FileContent
  path: string
}) {
  return (
    <div className="flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden">
      <FileHeader path={path} />
      <DevelopmentScrollArea className="min-h-0 w-full max-w-full flex-1">
        <div className="flex min-h-full min-w-full items-center justify-center p-6">
          <img
            alt={filename(path)}
            className="max-h-full max-w-full object-contain"
            src={`data:${content.mimeType};base64,${content.content}`}
          />
        </div>
      </DevelopmentScrollArea>
    </div>
  )
}

function FileHeader({ path }: { path: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 border-b px-4 py-2">
      <FileIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate font-medium">{filename(path)}</span>
      <span className="truncate text-xs text-muted-foreground">{path}</span>
    </div>
  )
}

function FileSkeleton() {
  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-6 w-1/4" />
      <Skeleton className="h-32 w-full" />
    </div>
  )
}

function EmptyFileState({
  description,
  title,
}: {
  description: string
  title: string
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <FileIcon className="size-8 text-muted-foreground" />
      <h3 className="font-heading text-lg font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

function sourceText(content: FileContent) {
  if (content.encoding === "base64") return ""
  return content.content
}

function isImageContent(content: FileContent) {
  return content.encoding === "base64" && content.mimeType?.startsWith("image/")
}

function contentDiff(path: string, content: FileContent): VcsFileDiff | undefined {
  if (!content.diff) return undefined
  const parsed = parseGitDiff(content.diff)[0]
  return parsed
    ? { ...parsed, file: path }
    : { file: path, patch: content.diff, status: "modified" }
}
