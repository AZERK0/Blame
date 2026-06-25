import type { GitStatusFile, GitStatusResult } from "@/context/platform"
import type { GitSelection } from "@/components/git/git-types"
import { gitFileSelection, gitSelectionKey } from "@/components/git/git-types"
import { gitStatusClassName, gitStatusLabel } from "@/components/git/git-format"
import {
  CheckCircle2Icon,
  GitBranchIcon,
  MinusIcon,
  PlusIcon,
  RefreshCwIcon,
  UploadIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

export function GitWorkspacePanel({
  busy,
  commitMessage,
  loading,
  onCommit,
  onCommitMessageChange,
  onCommitPush,
  onFileSelect,
  onRefresh,
  onStageAll,
  onStageFile,
  onUnstageAll,
  onUnstageFile,
  selected,
  status,
}: {
  busy?: string
  commitMessage: string
  loading: boolean
  onCommit(): void
  onCommitMessageChange(value: string): void
  onCommitPush(): void
  onFileSelect(selection: GitSelection): void
  onRefresh(): void
  onStageAll(): void
  onStageFile(path: string): void
  onUnstageAll(): void
  onUnstageFile(path: string): void
  selected?: GitSelection
  status?: GitStatusResult
}) {
  const staged = status?.files.filter((file) => file.staged) ?? []
  const workspace = status?.files.filter((file) => file.unstaged) ?? []
  const disabled = Boolean(busy)

  return (
    <aside className="flex min-h-[34rem] min-w-0 flex-col border-b bg-background xl:min-h-0 xl:border-r xl:border-b-0">
      <WorkspaceHeader
        loading={loading}
        onRefresh={onRefresh}
        status={status}
      />
      <WorkspaceActions
        disabled={disabled}
        stagedCount={staged.length}
        workspaceCount={workspace.length}
        onStageAll={onStageAll}
        onUnstageAll={onUnstageAll}
      />
      <ScrollArea className="min-h-0 flex-1">
        {loading && !status ? <WorkspaceSkeleton /> : null}
        {status ? (
          <div className="flex min-w-0 flex-col gap-4 p-3">
            <FileGroup
              files={staged}
              selected={selected}
              staged
              title="Staged"
              onFileSelect={onFileSelect}
              onFileAction={onUnstageFile}
            />
            <FileGroup
              files={workspace}
              selected={selected}
              title="Workspace"
              onFileSelect={onFileSelect}
              onFileAction={onStageFile}
            />
          </div>
        ) : null}
      </ScrollArea>
      <CommitComposer
        busy={busy}
        canCommit={staged.length > 0}
        message={commitMessage}
        onChange={onCommitMessageChange}
        onCommit={onCommit}
        onCommitPush={onCommitPush}
      />
    </aside>
  )
}

function WorkspaceHeader({
  loading,
  onRefresh,
  status,
}: {
  loading: boolean
  onRefresh(): void
  status?: GitStatusResult
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 border-b px-3 py-2">
      <GitBranchIcon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {status?.branch.current ?? "Repository"}
        </div>
        <BranchMeta status={status} />
      </div>
      <Button
        disabled={loading}
        size="icon-sm"
        variant="ghost"
        onClick={onRefresh}
      >
        <RefreshCwIcon className={cn("size-4", loading && "animate-spin")} />
        <span className="sr-only">Refresh Git state</span>
      </Button>
    </div>
  )
}

function BranchMeta({ status }: { status?: GitStatusResult }) {
  const branch = status?.branch
  if (!branch)
    return <div className="text-xs text-muted-foreground">Loading</div>
  const sync = [
    branch.ahead ? `${branch.ahead} ahead` : "",
    branch.behind ? `${branch.behind} behind` : "",
  ]
    .filter(Boolean)
    .join(", ")
  return (
    <div className="truncate text-xs text-muted-foreground">
      {branch.upstream ?? (branch.detached ? "Detached HEAD" : "No upstream")}
      {sync ? ` · ${sync}` : ""}
    </div>
  )
}

function WorkspaceActions({
  disabled,
  onStageAll,
  onUnstageAll,
  stagedCount,
  workspaceCount,
}: {
  disabled: boolean
  onStageAll(): void
  onUnstageAll(): void
  stagedCount: number
  workspaceCount: number
}) {
  return (
    <div className="flex items-center gap-2 border-b px-3 py-2">
      <Badge variant="outline">{stagedCount} staged</Badge>
      <Badge variant="outline">{workspaceCount} changed</Badge>
      <div className="ml-auto flex items-center gap-1">
        <Button
          disabled={disabled || workspaceCount === 0}
          size="icon-sm"
          variant="ghost"
          onClick={onStageAll}
        >
          <PlusIcon className="size-4" />
          <span className="sr-only">Stage all</span>
        </Button>
        <Button
          disabled={disabled || stagedCount === 0}
          size="icon-sm"
          variant="ghost"
          onClick={onUnstageAll}
        >
          <MinusIcon className="size-4" />
          <span className="sr-only">Unstage all</span>
        </Button>
      </div>
    </div>
  )
}

function FileGroup({
  files,
  onFileAction,
  onFileSelect,
  selected,
  staged = false,
  title,
}: {
  files: GitStatusFile[]
  onFileAction(path: string): void
  onFileSelect(selection: GitSelection): void
  selected?: GitSelection
  staged?: boolean
  title: string
}) {
  return (
    <section className="min-w-0">
      <div className="mb-1 px-1 text-xs font-medium text-muted-foreground">
        {title}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        {files.length ? (
          files.map((file) => (
            <FileRow
              file={file}
              key={`${title}:${file.path}`}
              selected={selected}
              staged={staged}
              onAction={onFileAction}
              onSelect={onFileSelect}
            />
          ))
        ) : (
          <EmptyGroup staged={staged} />
        )}
      </div>
    </section>
  )
}

function FileRow({
  file,
  onAction,
  onSelect,
  selected,
  staged,
}: {
  file: GitStatusFile
  onAction(path: string): void
  onSelect(selection: GitSelection): void
  selected?: GitSelection
  staged: boolean
}) {
  const selection = gitFileSelection(file.path, staged)
  const active = gitSelectionKey(selection) === gitSelectionKey(selected)

  return (
    <div
      className={cn(
        "group grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center rounded-md hover:bg-muted",
        active && "bg-muted"
      )}
    >
      <button
        className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 px-2 py-1.5 text-left text-sm"
        type="button"
        onClick={() => onSelect(selection)}
      >
        <Badge className={gitStatusClassName(file.status)} variant="outline">
          {gitStatusLabel(file.status)}
        </Badge>
        <span className="min-w-0 truncate">{file.path}</span>
      </button>
      <Button
        className="mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        size="icon-xs"
        variant="ghost"
        onClick={() => onAction(file.path)}
      >
        {staged ? (
          <MinusIcon className="size-3.5" />
        ) : (
          <PlusIcon className="size-3.5" />
        )}
        <span className="sr-only">{staged ? "Unstage file" : "Stage file"}</span>
      </Button>
    </div>
  )
}

function EmptyGroup({ staged }: { staged: boolean }) {
  return (
    <div className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
      {staged ? "Nothing staged" : "No workspace changes"}
    </div>
  )
}

function CommitComposer({
  busy,
  canCommit,
  message,
  onChange,
  onCommit,
  onCommitPush,
}: {
  busy?: string
  canCommit: boolean
  message: string
  onChange(value: string): void
  onCommit(): void
  onCommitPush(): void
}) {
  const disabled = !canCommit || !message.trim() || Boolean(busy)

  return (
    <div className="flex shrink-0 flex-col gap-2 border-t p-3">
      <Textarea
        className="min-h-24 resize-none font-mono text-xs"
        placeholder="Commit message"
        value={message}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="flex min-w-0 items-center gap-2">
        <Button disabled={disabled} size="sm" onClick={onCommit}>
          <CheckCircle2Icon className="size-4" />
          Commit
        </Button>
        <Button
          disabled={disabled}
          size="sm"
          variant="outline"
          onClick={onCommitPush}
        >
          <UploadIcon className="size-4" />
          Commit & Push
        </Button>
      </div>
      {busy ? (
        <div className="truncate text-xs text-muted-foreground">{busy}</div>
      ) : null}
    </div>
  )
}

function WorkspaceSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-3">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-5/6" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-4/5" />
    </div>
  )
}
