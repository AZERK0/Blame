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
  PencilLineIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
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
  generatingCommitMessage,
  loading,
  onCommit,
  onCommitMessageChange,
  onCommitPush,
  onClearSelection,
  onDeleteFile,
  onFileSelect,
  onGitAddFile,
  onGenerateCommitMessage,
  onRefresh,
  onRollbackFile,
  onSelectAll,
  onSelectFile,
  onSelectFiles,
  onUnselectFile,
  onUnselectFiles,
  selected,
  selectedFilePaths,
  status,
}: {
  busy?: string
  commitMessage: string
  generatingCommitMessage: boolean
  loading: boolean
  onCommit(): void
  onCommitMessageChange(value: string): void
  onCommitPush(): void
  onClearSelection(): void
  onDeleteFile(path: string): void
  onFileSelect(selection: GitSelection): void
  onGitAddFile(path: string): void
  onGenerateCommitMessage(): void
  onRefresh(): void
  onRollbackFile(path: string): void
  onSelectAll(): void
  onSelectFile(path: string): void
  onSelectFiles(paths: string[]): void
  onUnselectFile(path: string): void
  onUnselectFiles(paths: string[]): void
  selected?: GitSelection
  selectedFilePaths: ReadonlySet<string>
  status?: GitStatusResult
}) {
  const changes = status?.files.filter((file) => !file.untracked) ?? []
  const unversioned = status?.files.filter((file) => file.untracked) ?? []
  const fileCount = status?.files.length ?? 0
  const selectedCount =
    status?.files.filter((file) => selectedFilePaths.has(file.path)).length ?? 0
  const hasChanges = changes.length + unversioned.length > 0
  const hasConflicts =
    status?.files.some(
      (file) => file.conflicted || file.status === "conflict"
    ) ?? false
  const disabled = Boolean(busy)
  const [pendingAction, setPendingAction] =
    React.useState<PendingFileAction | null>(null)

  return (
    <>
      <aside className="flex min-h-[34rem] min-w-0 flex-col overflow-hidden rounded-lg border bg-muted/30 shadow-xl ring-1 shadow-black/10 ring-foreground/15 xl:min-h-0">
        <WorkspaceHeader
          loading={loading}
          onRefresh={onRefresh}
          status={status}
        />
        <WorkspaceActions
          disabled={disabled}
          fileCount={fileCount}
          selectedCount={selectedCount}
          unversionedCount={unversioned.length}
          onClearSelection={onClearSelection}
          onSelectAll={onSelectAll}
        />
        <ScrollArea className="min-h-0 flex-1 bg-foreground/5 dark:bg-background">
          {loading && !status ? <WorkspaceSkeleton /> : null}
          {status ? (
            <div className="flex min-w-0 flex-col gap-2 p-3">
              <ChangesGroup
                disabled={disabled}
                files={changes}
                selected={selected}
                selectedFilePaths={selectedFilePaths}
                onFileSelect={onFileSelect}
                onGitAddFile={onGitAddFile}
                onSelectFile={onSelectFile}
                onSelectFiles={onSelectFiles}
                onUnselectFile={onUnselectFile}
                onUnselectFiles={onUnselectFiles}
                onDeleteFile={(file) =>
                  setPendingAction({ file, type: "delete" })
                }
                onRollbackFile={(file) =>
                  setPendingAction({ file, type: "rollback" })
                }
              />
              {unversioned.length > 0 ? (
                <UnversionedGroup
                  disabled={disabled}
                  files={unversioned}
                  selected={selected}
                  selectedFilePaths={selectedFilePaths}
                  onFileSelect={onFileSelect}
                  onGitAddFile={onGitAddFile}
                  onSelectFile={onSelectFile}
                  onSelectFiles={onSelectFiles}
                  onUnselectFile={onUnselectFile}
                  onUnselectFiles={onUnselectFiles}
                  onDeleteFile={(file) =>
                    setPendingAction({ file, type: "delete" })
                  }
                  onRollbackFile={(file) =>
                    setPendingAction({ file, type: "rollback" })
                  }
                />
              ) : null}
            </div>
          ) : null}
        </ScrollArea>
        <CommitComposer
          busy={busy}
          canCommit={selectedCount > 0 && !hasConflicts}
          canGenerateMessage={selectedCount > 0 && !hasConflicts}
          generatingMessage={generatingCommitMessage}
          hasConflicts={hasConflicts}
          hasChanges={hasChanges}
          message={commitMessage}
          onChange={onCommitMessageChange}
          onCommit={onCommit}
          onCommitPush={onCommitPush}
          onGenerateMessage={onGenerateCommitMessage}
        />
      </aside>
      <ConfirmFileActionDialog
        pendingAction={pendingAction}
        onCancel={() => setPendingAction(null)}
        onConfirm={(action) => {
          setPendingAction(null)
          if (action.type === "delete") onDeleteFile(action.file.path)
          else onRollbackFile(action.file.path)
        }}
      />
    </>
  )
}

type PendingFileAction = {
  file: GitStatusFile
  type: "delete" | "rollback"
}

type FileActionMenuItemProps = {
  disabled: boolean
  file: GitStatusFile
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
    <div className="flex min-w-0 items-center gap-2 border-b bg-muted/30 px-3 py-2">
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
  fileCount,
  onClearSelection,
  onSelectAll,
  selectedCount,
  unversionedCount,
}: {
  disabled: boolean
  fileCount: number
  onClearSelection(): void
  onSelectAll(): void
  selectedCount: number
  unversionedCount: number
}) {
  const allSelected = fileCount > 0 && selectedCount === fileCount

  return (
    <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
      <Badge variant="outline">{selectedCount} selected</Badge>
      <Badge variant="outline">{unversionedCount} unversioned</Badge>
      <div className="ml-auto flex items-center gap-1">
        <IconAction label="Select all changes">
          <Button
            disabled={disabled || fileCount === 0 || allSelected}
            size="icon-sm"
            variant="ghost"
            onClick={onSelectAll}
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
            onClick={onClearSelection}
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
  onGitAddFile,
  onSelectFile,
  onSelectFiles,
  onDeleteFile,
  onRollbackFile,
  onUnselectFile,
  onUnselectFiles,
  selected,
  selectedFilePaths,
}: {
  disabled: boolean
  files: GitStatusFile[]
  onFileSelect(selection: GitSelection): void
  onGitAddFile(path: string): void
  onSelectFile(path: string): void
  onSelectFiles(paths: string[]): void
  onDeleteFile(file: GitStatusFile): void
  onRollbackFile(file: GitStatusFile): void
  onUnselectFile(path: string): void
  onUnselectFiles(paths: string[]): void
  selected?: GitSelection
  selectedFilePaths: ReadonlySet<string>
}) {
  const [open, setOpen] = React.useState(true)
  const allSelected =
    files.length > 0 && files.every((file) => selectedFilePaths.has(file.path))

  return (
    <FileGroupFrame
      allSelected={allSelected}
      count={files.length}
      disabled={disabled}
      open={open}
      title="Changes"
      onOpenChange={setOpen}
      onToggleAll={() =>
        toggleFiles(files, allSelected, onSelectFiles, onUnselectFiles)
      }
    >
      {files.length ? (
        files.map((file) => (
          <VersionedFileRow
            disabled={disabled}
            file={file}
            key={`changes:${file.path}`}
            selected={selected}
            selectedFilePaths={selectedFilePaths}
            onSelect={onFileSelect}
            onGitAdd={onGitAddFile}
            onSelectFile={onSelectFile}
            onDeleteFile={onDeleteFile}
            onRollbackFile={onRollbackFile}
            onUnselectFile={onUnselectFile}
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
  onGitAddFile,
  onSelectFile,
  onSelectFiles,
  onDeleteFile,
  onRollbackFile,
  onUnselectFile,
  onUnselectFiles,
  selected,
  selectedFilePaths,
}: {
  disabled: boolean
  files: GitStatusFile[]
  onFileSelect(selection: GitSelection): void
  onGitAddFile(path: string): void
  onSelectFile(path: string): void
  onSelectFiles(paths: string[]): void
  onDeleteFile(file: GitStatusFile): void
  onRollbackFile(file: GitStatusFile): void
  onUnselectFile(path: string): void
  onUnselectFiles(paths: string[]): void
  selected?: GitSelection
  selectedFilePaths: ReadonlySet<string>
}) {
  const [open, setOpen] = React.useState(true)
  const allSelected =
    files.length > 0 && files.every((file) => selectedFilePaths.has(file.path))

  return (
    <FileGroupFrame
      allSelected={allSelected}
      count={files.length}
      disabled={disabled}
      open={open}
      title="Unversioned Files"
      onOpenChange={setOpen}
      onToggleAll={() =>
        toggleFiles(files, allSelected, onSelectFiles, onUnselectFiles)
      }
    >
      {files.length ? (
        files.map((file) => (
          <UnversionedFileRow
            disabled={disabled}
            file={file}
            key={`unversioned:${file.path}`}
            selected={selected}
            selectedFilePaths={selectedFilePaths}
            onSelect={onFileSelect}
            onGitAdd={onGitAddFile}
            onSelectFile={onSelectFile}
            onDeleteFile={onDeleteFile}
            onRollbackFile={onRollbackFile}
            onUnselectFile={onUnselectFile}
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
  onGitAdd,
  onSelect,
  onSelectFile,
  onDeleteFile,
  onRollbackFile,
  onUnselectFile,
  selected,
  selectedFilePaths,
}: {
  disabled: boolean
  file: GitStatusFile
  onGitAdd(path: string): void
  onSelect(selection: GitSelection): void
  onSelectFile(path: string): void
  onDeleteFile(file: GitStatusFile): void
  onRollbackFile(file: GitStatusFile): void
  onUnselectFile(path: string): void
  selected?: GitSelection
  selectedFilePaths: ReadonlySet<string>
}) {
  const checked = selectedFilePaths.has(file.path)

  return (
    <FileRowShell
      checked={checked}
      disabled={disabled}
      file={file}
      selected={selected}
      onDeleteFile={onDeleteFile}
      onGitAdd={onGitAdd}
      onRollbackFile={onRollbackFile}
      onSelect={onSelect}
      onToggle={() =>
        checked ? onUnselectFile(file.path) : onSelectFile(file.path)
      }
    />
  )
}

function UnversionedFileRow({
  disabled,
  file,
  onGitAdd,
  onSelect,
  onSelectFile,
  onDeleteFile,
  onRollbackFile,
  onUnselectFile,
  selected,
  selectedFilePaths,
}: {
  disabled: boolean
  file: GitStatusFile
  onGitAdd(path: string): void
  onSelect(selection: GitSelection): void
  onSelectFile(path: string): void
  onDeleteFile(file: GitStatusFile): void
  onRollbackFile(file: GitStatusFile): void
  onUnselectFile(path: string): void
  selected?: GitSelection
  selectedFilePaths: ReadonlySet<string>
}) {
  const checked = selectedFilePaths.has(file.path)

  return (
    <FileRowShell
      checked={checked}
      disabled={disabled}
      file={file}
      selected={selected}
      onDeleteFile={onDeleteFile}
      onGitAdd={onGitAdd}
      onRollbackFile={onRollbackFile}
      onSelect={onSelect}
      onToggle={() =>
        checked ? onUnselectFile(file.path) : onSelectFile(file.path)
      }
    />
  )
}

function FileRowShell({
  checked,
  disabled,
  file,
  onDeleteFile,
  onGitAdd,
  onRollbackFile,
  onSelect,
  onToggle,
  selected,
}: {
  checked: boolean
  disabled: boolean
  file: GitStatusFile
  onDeleteFile(file: GitStatusFile): void
  onGitAdd(path: string): void
  onRollbackFile(file: GitStatusFile): void
  onSelect(selection: GitSelection): void
  onToggle(): void
  selected?: GitSelection
}) {
  const selection = gitFileSelection(file.path, file.staged)
  const active = gitSelectionKey(selection) === gitSelectionKey(selected)

  return (
    <FileContextMenu
      disabled={disabled}
      file={file}
      onDeleteFile={onDeleteFile}
      onGitAdd={onGitAdd}
      onRollbackFile={onRollbackFile}
    >
      <div
        className={cn(
          "group grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center rounded-md pl-8 hover:bg-muted",
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
      </div>
    </FileContextMenu>
  )
}

function FileContextMenu({
  children,
  disabled,
  file,
  onDeleteFile,
  onGitAdd,
  onRollbackFile,
}: {
  children: React.ReactNode
  disabled: boolean
  file: GitStatusFile
  onDeleteFile(file: GitStatusFile): void
  onGitAdd(path: string): void
  onRollbackFile(file: GitStatusFile): void
}) {
  const canGitAdd = file.unstaged
  const canRollback = !file.untracked
  const canDelete = file.status !== "deleted"

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <GitAddMenuItem
          disabled={disabled || !canGitAdd}
          file={file}
          onGitAdd={onGitAdd}
        />
        <RollbackFileMenuItem
          disabled={disabled || !canRollback}
          file={file}
          onRollbackFile={onRollbackFile}
        />
        <ContextMenuSeparator />
        <DeleteFileMenuItem
          disabled={disabled || !canDelete}
          file={file}
          onDeleteFile={onDeleteFile}
        />
      </ContextMenuContent>
    </ContextMenu>
  )
}

function GitAddMenuItem({
  disabled,
  file,
  onGitAdd,
}: FileActionMenuItemProps & {
  onGitAdd(path: string): void
}) {
  return (
    <ContextMenuItem disabled={disabled} onSelect={() => onGitAdd(file.path)}>
      <PlusIcon className="size-4" />
      Git add
    </ContextMenuItem>
  )
}

function RollbackFileMenuItem({
  disabled,
  file,
  onRollbackFile,
}: FileActionMenuItemProps & {
  onRollbackFile(file: GitStatusFile): void
}) {
  return (
    <ContextMenuItem disabled={disabled} onSelect={() => onRollbackFile(file)}>
      <RotateCcwIcon className="size-4" />
      Rollback changes
    </ContextMenuItem>
  )
}

function DeleteFileMenuItem({
  disabled,
  file,
  onDeleteFile,
}: FileActionMenuItemProps & {
  onDeleteFile(file: GitStatusFile): void
}) {
  return (
    <ContextMenuItem
      disabled={disabled}
      variant="destructive"
      onSelect={() => onDeleteFile(file)}
    >
      <Trash2Icon className="size-4" />
      Delete file
    </ContextMenuItem>
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

function toggleFiles(
  files: GitStatusFile[],
  allSelected: boolean,
  onSelectFiles: (paths: string[]) => void,
  onUnselectFiles: (paths: string[]) => void
) {
  const paths = files.map((file) => file.path)
  if (paths.length === 0) return
  if (allSelected) onUnselectFiles(paths)
  else onSelectFiles(paths)
}

function splitFilePath(path: string) {
  const separatorIndex = path.lastIndexOf("/")
  if (separatorIndex === -1) return { directory: "", name: path }
  return {
    directory: path.slice(0, separatorIndex),
    name: path.slice(separatorIndex + 1),
  }
}

function ConfirmFileActionDialog({
  pendingAction,
  onCancel,
  onConfirm,
}: {
  pendingAction: PendingFileAction | null
  onCancel(): void
  onConfirm(action: PendingFileAction): void
}) {
  return (
    <AlertDialog
      open={Boolean(pendingAction)}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {pendingAction ? fileActionTitle(pendingAction) : "Confirm action"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pendingAction ? fileActionDescription(pendingAction) : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={
              pendingAction?.type === "delete" ? "destructive" : "default"
            }
            onClick={() => {
              if (pendingAction) onConfirm(pendingAction)
            }}
          >
            {pendingAction ? fileActionButtonLabel(pendingAction) : "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function fileActionTitle(action: PendingFileAction) {
  if (action.type === "delete") return "Delete file?"
  return "Rollback changes?"
}

function fileActionDescription(action: PendingFileAction) {
  if (action.type === "delete") {
    return `Delete ${action.file.path} from the workspace.`
  }
  if (action.file.status === "added") {
    return `Move ${action.file.path} back to Unversioned Files.`
  }
  return `Restore ${action.file.path} to the last committed version.`
}

function fileActionButtonLabel(action: PendingFileAction) {
  if (action.type === "delete") return "Delete"
  return "Rollback"
}

function CommitComposer({
  busy,
  canCommit,
  canGenerateMessage,
  generatingMessage,
  hasConflicts,
  hasChanges,
  message,
  onChange,
  onCommit,
  onCommitPush,
  onGenerateMessage,
}: {
  busy?: string
  canCommit: boolean
  canGenerateMessage: boolean
  generatingMessage: boolean
  hasConflicts: boolean
  hasChanges: boolean
  message: string
  onChange(value: string): void
  onCommit(): void
  onCommitPush(): void
  onGenerateMessage(): void
}) {
  const actionBusy = Boolean(busy) || generatingMessage
  const disabled = !canCommit || !message.trim() || actionBusy

  return (
    <div
      className={cn(
        "flex shrink-0 flex-col gap-2 border-t bg-muted/30 p-3",
        !hasChanges && "opacity-70"
      )}
    >
      <div className="relative min-w-0">
        <Textarea
          className="min-h-24 resize-none pb-10 pr-10 font-mono text-xs"
          disabled={!hasChanges || hasConflicts || generatingMessage}
          placeholder={commitMessagePlaceholder(hasChanges, hasConflicts)}
          value={message}
          onChange={(event) => onChange(event.target.value)}
        />
        <IconAction label="Generate commit message with AI">
          <Button
            className="absolute bottom-2 right-2"
            disabled={!canGenerateMessage || actionBusy}
            size="sm"
            type="button"
            variant="ghost"
            onClick={onGenerateMessage}
          >
            <PencilLineIcon
              className={cn("size-4", generatingMessage && "animate-pulse")}
            />
            Auto Message
            <span className="sr-only">Generate commit message with AI</span>
          </Button>
        </IconAction>
      </div>
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
      <CommitHint
        busy={busy}
        canCommit={canCommit}
        hasChanges={hasChanges}
        hasConflicts={hasConflicts}
      />
    </div>
  )
}

function commitMessagePlaceholder(hasChanges: boolean, hasConflicts: boolean) {
  if (hasConflicts) return "Resolve conflicts first"
  return hasChanges ? "Commit message" : "No changes to commit"
}

function CommitHint({
  busy,
  canCommit,
  hasConflicts,
  hasChanges,
}: {
  busy?: string
  canCommit: boolean
  hasConflicts: boolean
  hasChanges: boolean
}) {
  if (busy)
    return <div className="truncate text-xs text-muted-foreground">{busy}</div>
  if (!hasChanges)
    return (
      <div className="text-xs text-muted-foreground">No changes to commit.</div>
    )
  if (hasConflicts)
    return (
      <div className="text-xs text-muted-foreground">
        Resolve conflicts before committing.
      </div>
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
