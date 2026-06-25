import * as React from "react"
import type { GitStatusFile, GitStatusResult } from "@/context/platform"
import type { GitSelection } from "@/components/git/git-types"
import { gitFileSelection, gitSelectionKey } from "@/components/git/git-types"
import { gitStatusClassName, gitStatusLabel } from "@/components/git/git-format"
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  GitBranchIcon,
  MinusIcon,
  PlusIcon,
  RefreshCwIcon,
  UploadIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
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
  onStageFiles,
  onUnstageAll,
  onUnstageFile,
  onUnstageFiles,
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
  onStageFiles(paths: string[]): void
  onUnstageAll(): void
  onUnstageFile(path: string): void
  onUnstageFiles(paths: string[]): void
  selected?: GitSelection
  status?: GitStatusResult
}) {
  const changes = status?.files.filter((file) => !file.untracked) ?? []
  const unversioned = status?.files.filter((file) => file.untracked) ?? []
  const selectedCount = changes.filter((file) => file.staged).length
  const unstagedCount =
    status?.files.filter((file) => file.unstaged).length ?? 0
  const hasChanges = changes.length + unversioned.length > 0
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
        selectedCount={selectedCount}
        unstagedCount={unstagedCount}
        unversionedCount={unversioned.length}
        onStageAll={onStageAll}
        onUnstageAll={onUnstageAll}
      />
      <ScrollArea className="min-h-0 flex-1">
        {loading && !status ? <WorkspaceSkeleton /> : null}
        {status ? (
          <div className="flex min-w-0 flex-col gap-2 p-3">
            <ChangesGroup
              disabled={disabled}
              files={changes}
              selected={selected}
              onFileSelect={onFileSelect}
              onStageFile={onStageFile}
              onStageFiles={onStageFiles}
              onUnstageFile={onUnstageFile}
              onUnstageFiles={onUnstageFiles}
            />
            {unversioned.length > 0 ? (
              <UnversionedGroup
                disabled={disabled}
                files={unversioned}
                selected={selected}
                onFileSelect={onFileSelect}
                onStageFile={onStageFile}
                onStageFiles={onStageFiles}
              />
            ) : null}
          </div>
        ) : null}
      </ScrollArea>
      <CommitComposer
        busy={busy}
        canCommit={selectedCount > 0}
        hasChanges={hasChanges}
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
      <IconAction label="Refresh Git state">
        <Button
          disabled={loading}
          size="icon-sm"
          variant="ghost"
          onClick={onRefresh}
        >
          <RefreshCwIcon className={cn("size-4", loading && "animate-spin")} />
          <span className="sr-only">Refresh Git state</span>
        </Button>
      </IconAction>
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
  selectedCount,
  unstagedCount,
  unversionedCount,
}: {
  disabled: boolean
  onStageAll(): void
  onUnstageAll(): void
  selectedCount: number
  unstagedCount: number
  unversionedCount: number
}) {
  return (
    <div className="flex items-center gap-2 border-b px-3 py-2">
      <Badge variant="outline">{selectedCount} selected</Badge>
      <Badge variant="outline">{unversionedCount} unversioned</Badge>
      <div className="ml-auto flex items-center gap-1">
        <IconAction label="Select all changes">
          <Button
            disabled={disabled || unstagedCount === 0}
            size="icon-sm"
            variant="ghost"
            onClick={onStageAll}
          >
            <PlusIcon className="size-4" />
            <span className="sr-only">Select all changes</span>
          </Button>
        </IconAction>
        <IconAction label="Unselect all files">
          <Button
            disabled={disabled || selectedCount === 0}
            size="icon-sm"
            variant="ghost"
            onClick={onUnstageAll}
          >
            <MinusIcon className="size-4" />
            <span className="sr-only">Unselect all files</span>
          </Button>
        </IconAction>
      </div>
    </div>
  )
}

function ChangesGroup({
  disabled,
  files,
  onFileSelect,
  onStageFile,
  onStageFiles,
  onUnstageFile,
  onUnstageFiles,
  selected,
}: {
  disabled: boolean
  files: GitStatusFile[]
  onFileSelect(selection: GitSelection): void
  onStageFile(path: string): void
  onStageFiles(paths: string[]): void
  onUnstageFile(path: string): void
  onUnstageFiles(paths: string[]): void
  selected?: GitSelection
}) {
  const [open, setOpen] = React.useState(true)
  const allSelected = files.length > 0 && files.every((file) => file.staged)

  return (
    <FileGroupFrame
      allSelected={allSelected}
      count={files.length}
      disabled={disabled}
      open={open}
      title="Changes"
      onOpenChange={setOpen}
      onToggleAll={() =>
        toggleChanges(files, allSelected, onStageFiles, onUnstageFiles)
      }
    >
      {files.length ? (
        files.map((file) => (
          <VersionedFileRow
            disabled={disabled}
            file={file}
            key={`changes:${file.path}`}
            selected={selected}
            onSelect={onFileSelect}
            onStage={onStageFile}
            onUnstage={onUnstageFile}
          />
        ))
      ) : (
        <EmptyGroup label="No changed files" />
      )}
    </FileGroupFrame>
  )
}

function UnversionedGroup({
  disabled,
  files,
  onFileSelect,
  onStageFile,
  onStageFiles,
  selected,
}: {
  disabled: boolean
  files: GitStatusFile[]
  onFileSelect(selection: GitSelection): void
  onStageFile(path: string): void
  onStageFiles(paths: string[]): void
  selected?: GitSelection
}) {
  const [open, setOpen] = React.useState(true)

  return (
    <FileGroupFrame
      allSelected={false}
      count={files.length}
      disabled={disabled}
      open={open}
      title="Unversioned Files"
      onOpenChange={setOpen}
      onToggleAll={() => onStageFiles(files.map((file) => file.path))}
    >
      {files.length ? (
        files.map((file) => (
          <UnversionedFileRow
            disabled={disabled}
            file={file}
            key={`unversioned:${file.path}`}
            selected={selected}
            onSelect={onFileSelect}
            onStage={onStageFile}
          />
        ))
      ) : (
        <EmptyGroup label="No unversioned files" />
      )}
    </FileGroupFrame>
  )
}

function FileGroupFrame({
  allSelected,
  children,
  count,
  disabled,
  onOpenChange,
  onToggleAll,
  open,
  title,
}: {
  allSelected: boolean
  children: React.ReactNode
  count: number
  disabled: boolean
  onOpenChange(open: boolean): void
  onToggleAll(): void
  open: boolean
  title: string
}) {
  return (
    <section className="min-w-0">
      <div className="flex min-w-0 items-center rounded-md px-1.5 py-1 text-sm hover:bg-muted">
        <Button
          className="mr-1 size-5 shrink-0"
          size="icon-xs"
          variant="ghost"
          onClick={() => onOpenChange(!open)}
        >
          {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
          <span className="sr-only">Toggle {title}</span>
        </Button>
        <Checkbox
          aria-label={`Select ${title}`}
          checked={allSelected}
          disabled={disabled || count === 0}
          onCheckedChange={onToggleAll}
        />
        <button
          className="ml-2 flex min-w-0 flex-1 items-center gap-2 text-left"
          type="button"
          onClick={() => onOpenChange(!open)}
        >
          <span className="truncate font-medium">{title}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {count} {count === 1 ? "file" : "files"}
          </span>
        </button>
      </div>
      {open ? (
        <div className="mt-1 flex min-w-0 flex-col gap-0.5">{children}</div>
      ) : null}
    </section>
  )
}

function VersionedFileRow({
  disabled,
  file,
  onSelect,
  onStage,
  onUnstage,
  selected,
}: {
  disabled: boolean
  file: GitStatusFile
  onStage(path: string): void
  onUnstage(path: string): void
  onSelect(selection: GitSelection): void
  selected?: GitSelection
}) {
  return (
    <FileRowShell
      checked={file.staged}
      disabled={disabled}
      file={file}
      selected={selected}
      onSelect={onSelect}
      onToggle={() => (file.staged ? onUnstage(file.path) : onStage(file.path))}
    />
  )
}

function UnversionedFileRow({
  disabled,
  file,
  onSelect,
  onStage,
  selected,
}: {
  disabled: boolean
  file: GitStatusFile
  onSelect(selection: GitSelection): void
  onStage(path: string): void
  selected?: GitSelection
}) {
  return (
    <FileRowShell
      action={
        <IconAction label="Add to Git">
          <Button
            className="mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            disabled={disabled}
            size="icon-xs"
            variant="ghost"
            onClick={() => onStage(file.path)}
          >
            <PlusIcon className="size-3.5" />
            <span className="sr-only">Add to Git</span>
          </Button>
        </IconAction>
      }
      checked={false}
      disabled={disabled}
      file={file}
      selected={selected}
      onSelect={onSelect}
      onToggle={() => onStage(file.path)}
    />
  )
}

function FileRowShell({
  action,
  checked,
  disabled,
  file,
  onSelect,
  onToggle,
  selected,
}: {
  action?: React.ReactNode
  checked: boolean
  disabled: boolean
  file: GitStatusFile
  onSelect(selection: GitSelection): void
  onToggle(): void
  selected?: GitSelection
}) {
  const selection = gitFileSelection(file.path, file.staged)
  const active = gitSelectionKey(selection) === gitSelectionKey(selected)

  return (
    <div
      className={cn(
        "group grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center rounded-md pl-8 hover:bg-muted",
        active && "bg-muted"
      )}
    >
      <Checkbox
        aria-label={`Select ${file.path} for commit`}
        checked={checked}
        className="ml-1"
        disabled={disabled}
        onCheckedChange={onToggle}
      />
      <button
        className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 px-2 py-1.5 text-left text-sm"
        type="button"
        onClick={() => onSelect(selection)}
      >
        <Badge className={gitStatusClassName(file.status)} variant="outline">
          {gitStatusLabel(file.status)}
        </Badge>
        <FilePathLabel path={file.path} />
      </button>
      {action}
    </div>
  )
}

function FilePathLabel({ path }: { path: string }) {
  const label = splitFilePath(path)

  return (
    <span className="flex min-w-0 items-baseline gap-1">
      <span className="min-w-0 truncate text-foreground">{label.name}</span>
      {label.directory ? (
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {label.directory}
        </span>
      ) : null}
    </span>
  )
}

function EmptyGroup({ label }: { label: string }) {
  return (
    <div className="px-10 py-1.5 text-xs text-muted-foreground">{label}</div>
  )
}

function toggleChanges(
  files: GitStatusFile[],
  allSelected: boolean,
  onStageFiles: (paths: string[]) => void,
  onUnstageFiles: (paths: string[]) => void
) {
  const paths = files
    .filter((file) => (allSelected ? file.staged : file.unstaged))
    .map((file) => file.path)
  if (paths.length === 0) return
  if (allSelected) onUnstageFiles(paths)
  else onStageFiles(paths)
}

function splitFilePath(path: string) {
  const separatorIndex = path.lastIndexOf("/")
  if (separatorIndex === -1) return { directory: "", name: path }
  return {
    directory: path.slice(0, separatorIndex),
    name: path.slice(separatorIndex + 1),
  }
}

function CommitComposer({
  busy,
  canCommit,
  hasChanges,
  message,
  onChange,
  onCommit,
  onCommitPush,
}: {
  busy?: string
  canCommit: boolean
  hasChanges: boolean
  message: string
  onChange(value: string): void
  onCommit(): void
  onCommitPush(): void
}) {
  const disabled = !canCommit || !message.trim() || Boolean(busy)

  return (
    <div
      className={cn(
        "flex shrink-0 flex-col gap-2 border-t p-3",
        !hasChanges && "opacity-70"
      )}
    >
      <Textarea
        className="min-h-24 resize-none font-mono text-xs"
        disabled={!hasChanges}
        placeholder={hasChanges ? "Commit message" : "No changes to commit"}
        value={message}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="flex min-w-0 items-center gap-2">
        <Button
          className="flex-1"
          disabled={disabled}
          size="sm"
          onClick={onCommit}
        >
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
      <CommitHint busy={busy} canCommit={canCommit} hasChanges={hasChanges} />
    </div>
  )
}

function CommitHint({
  busy,
  canCommit,
  hasChanges,
}: {
  busy?: string
  canCommit: boolean
  hasChanges: boolean
}) {
  if (busy)
    return <div className="truncate text-xs text-muted-foreground">{busy}</div>
  if (!hasChanges)
    return (
      <div className="text-xs text-muted-foreground">No changes to commit.</div>
    )
  if (!canCommit)
    return (
      <div className="text-xs text-muted-foreground">
        Select files before committing.
      </div>
    )
  return null
}

function IconAction({
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
