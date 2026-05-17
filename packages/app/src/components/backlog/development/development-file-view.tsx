import * as React from "react"
import type { FileContent, VcsFileDiff } from "@/components/backlog/development/development-workspace"
import { FileIcon } from "lucide-react"

import { DevelopmentDiffView } from "@/components/backlog/development/development-diff-view"
import { DevelopmentSelectableCode } from "@/components/backlog/development/development-selectable-code"
import { DevelopmentScrollArea } from "@/components/backlog/development/development-scroll-area"
import { filename } from "@/components/backlog/development/development-workspace"
import { Skeleton } from "@/components/ui/skeleton"

type FileState = {
  loading: boolean
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
  const [state, setState] = React.useState<FileState>({ loading: true })

  React.useEffect(() => {
    let cancelled = false
    setState((current) => current.content ? { ...current, error: undefined } : { loading: true })
    readFile(path)
      .then((content) => {
        if (!cancelled) setState({ loading: false, content })
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            loading: false,
            error: error instanceof Error ? error.message : "Unable to read file",
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [path, readFile, reloadKey])

  if (state.loading) return <FileSkeleton />

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
  return (
    <div className="flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden">
      <FileHeader path={path} />
      <DevelopmentScrollArea className="min-h-0 w-full max-w-full flex-1">
        <DevelopmentSelectableCode code={source} path={path} />
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
  return {
    additions: countLines(content.diff, "+"),
    deletions: countLines(content.diff, "-"),
    file: path,
    patch: content.diff,
    status: "modified",
  }
}

function countLines(diff: string, prefix: "+" | "-") {
  return diff
    .split("\n")
    .filter((line) => line.startsWith(prefix) && !line.startsWith(`${prefix}${prefix}${prefix}`))
    .length
}
