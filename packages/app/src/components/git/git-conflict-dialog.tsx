import * as React from "react"
import type {
  GitConflictFile,
  GitStatusFile,
  WorkspaceClient,
} from "@/context/platform"
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  GitMergeIcon,
  RotateCcwIcon,
  XCircleIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

export function GitConflictDialog({
  conflicts,
  onError,
  onOpenChange,
  onRefresh,
  open,
  root,
  workspace,
}: {
  conflicts: GitStatusFile[]
  onError(message: string): void
  onOpenChange(open: boolean): void
  onRefresh(): Promise<void> | void
  open: boolean
  root?: string
  workspace?: WorkspaceClient
}) {
  const [busy, setBusy] = React.useState<string>()
  const [conflict, setConflict] = React.useState<GitConflictFile>()
  const [result, setResult] = React.useState("")
  const [selectedPath, setSelectedPath] = React.useState<string>()
  const activePath =
    selectedPath && conflicts.some((file) => file.path === selectedPath)
      ? selectedPath
      : conflicts[0]?.path
  const selectedFile = conflicts.find((file) => file.path === activePath)
  const activeConflict = conflict?.path === activePath ? conflict : undefined
  const loading = Boolean(open && activePath && !activeConflict)

  React.useEffect(() => {
    if (!open || !root || !workspace || !activePath) return
    let cancelled = false
    workspace
      .gitConflictFile({ root, path: activePath })
      .then((nextConflict) => {
        if (cancelled) return
        setConflict(nextConflict)
        setResult(nextConflict.result)
      })
      .catch((error) => {
        if (!cancelled) reportConflictError(error, onError)
      })
    return () => {
      cancelled = true
    }
  }, [activePath, onError, open, root, workspace])

  const runAction = React.useCallback(
    (label: string, action: () => Promise<unknown>, close = false) => {
      void runConflictAction(
        label,
        action,
        close,
        onError,
        onOpenChange,
        onRefresh,
        setBusy
      )
    },
    [onError, onOpenChange, onRefresh]
  )

  const disabled = Boolean(busy) || loading || !root || !workspace
  const canContinue = conflicts.length === 0 && Boolean(root && workspace)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-hidden p-0 sm:max-w-[92vw]">
        <DialogHeader className="border-b px-5 py-4">
          <div className="flex min-w-0 items-center gap-2">
            <AlertTriangleIcon className="size-4 shrink-0 text-amber-500" />
            <DialogTitle>Merge conflicts</DialogTitle>
            <Badge variant="outline">{conflicts.length} remaining</Badge>
          </div>
          <DialogDescription>
            Resolve each conflicting file, then continue the Git operation.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 grid-cols-1 overflow-hidden lg:grid-cols-[20rem_minmax(0,1fr)]">
          <ConflictFileList
            conflicts={conflicts}
            selectedPath={activePath}
            onSelect={setSelectedPath}
          />
          <ConflictResolutionView
            busy={busy}
            conflict={activeConflict}
            disabled={disabled}
            file={selectedFile}
            loading={loading}
            result={loading ? "" : result}
            onAcceptCurrent={() => {
              if (!root || !workspace || !activePath) return
              runAction("Accepting current", () =>
                workspace.gitAcceptConflictFile({
                  root,
                  path: activePath,
                  side: "current",
                })
              )
            }}
            onAcceptIncoming={() => {
              if (!root || !workspace || !activePath) return
              runAction("Accepting incoming", () =>
                workspace.gitAcceptConflictFile({
                  root,
                  path: activePath,
                  side: "incoming",
                })
              )
            }}
            onResolve={() => {
              if (!root || !workspace || !activePath) return
              runAction("Marking resolved", () =>
                workspace.gitResolveConflictFile({
                  root,
                  path: activePath,
                  content: result,
                })
              )
            }}
            onResultChange={setResult}
          />
        </div>
        <DialogFooter className="mx-0 mb-0 gap-2 rounded-b-xl bg-muted/30 px-5 py-4">
          <Button
            disabled={disabled}
            type="button"
            variant="destructive"
            onClick={() => {
              if (!root || !workspace) return
              runAction(
                "Aborting Git operation",
                () => workspace.gitAbortConflict({ root }),
                true
              )
            }}
          >
            <XCircleIcon />
            Abort
          </Button>
          <Button
            disabled={!canContinue || Boolean(busy)}
            type="button"
            onClick={() => {
              if (!root || !workspace) return
              runAction(
                "Continuing Git operation",
                () => workspace.gitContinueConflict({ root }),
                true
              )
            }}
          >
            <GitMergeIcon />
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ConflictFileList({
  conflicts,
  onSelect,
  selectedPath,
}: {
  conflicts: GitStatusFile[]
  onSelect(path: string): void
  selectedPath?: string
}) {
  return (
    <aside className="min-h-0 border-b bg-muted/20 lg:border-r lg:border-b-0">
      <ScrollArea className="h-56 lg:h-[58vh]">
        <div className="grid gap-1 p-3">
          {conflicts.length === 0 ? <ResolvedConflictState /> : null}
          {conflicts.map((file) => (
            <button
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted",
                selectedPath === file.path && "bg-muted"
              )}
              key={file.path}
              type="button"
              onClick={() => onSelect(file.path)}
            >
              <span className="min-w-0 flex-1 truncate">{file.path}</span>
              <Badge className="shrink-0" variant="outline">
                {conflictStatusLabel(file)}
              </Badge>
            </button>
          ))}
        </div>
      </ScrollArea>
    </aside>
  )
}

function ConflictResolutionView({
  busy,
  conflict,
  disabled,
  file,
  loading,
  onAcceptCurrent,
  onAcceptIncoming,
  onResolve,
  onResultChange,
  result,
}: {
  busy?: string
  conflict?: GitConflictFile
  disabled: boolean
  file?: GitStatusFile
  loading: boolean
  onAcceptCurrent(): void
  onAcceptIncoming(): void
  onResolve(): void
  onResultChange(value: string): void
  result: string
}) {
  if (!file) {
    return (
      <div className="flex min-h-80 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
        <CheckCircle2Icon className="size-8 text-emerald-500" />
        <div>All conflicts are resolved.</div>
      </div>
    )
  }

  return (
    <section className="flex min-h-0 flex-col">
      <div className="flex min-w-0 flex-wrap items-center gap-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{file.path}</div>
          <div className="text-xs text-muted-foreground">
            {loading
              ? "Loading conflict versions"
              : "Edit the result to resolve"}
          </div>
        </div>
        <Button
          disabled={disabled}
          size="sm"
          type="button"
          variant="outline"
          onClick={onAcceptCurrent}
        >
          <RotateCcwIcon />
          Accept current
        </Button>
        <Button
          disabled={disabled}
          size="sm"
          type="button"
          variant="outline"
          onClick={onAcceptIncoming}
        >
          <RotateCcwIcon />
          Accept incoming
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid min-h-0 gap-3 p-4">
          <div className="grid min-h-0 gap-3 xl:grid-cols-3">
            <ConflictCodeBlock label="Base" value={conflict?.base ?? ""} />
            <ConflictCodeBlock
              label="Current"
              value={conflict?.current ?? ""}
            />
            <ConflictCodeBlock
              label="Incoming"
              value={conflict?.incoming ?? ""}
            />
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">Result</div>
              <Button
                disabled={disabled}
                size="sm"
                type="button"
                onClick={onResolve}
              >
                <CheckCircle2Icon />
                Mark resolved
              </Button>
            </div>
            <Textarea
              className="min-h-72 resize-none font-mono text-xs leading-5"
              disabled={disabled}
              value={result}
              onChange={(event) => onResultChange(event.target.value)}
            />
          </div>
          {busy ? (
            <div className="text-xs text-muted-foreground">{busy}</div>
          ) : null}
        </div>
      </ScrollArea>
    </section>
  )
}

function ConflictCodeBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-md border">
      <div className="border-b bg-muted/40 px-3 py-2 text-xs font-medium">
        {label}
      </div>
      <pre className="max-h-72 min-h-48 overflow-auto p-3 font-mono text-xs leading-5 whitespace-pre">
        {value || " "}
      </pre>
    </div>
  )
}

function ResolvedConflictState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
      <CheckCircle2Icon className="size-7 text-emerald-500" />
      <div>No unresolved files.</div>
    </div>
  )
}

async function runConflictAction(
  label: string,
  action: () => Promise<unknown>,
  close: boolean,
  onError: (message: string) => void,
  onOpenChange: (open: boolean) => void,
  onRefresh: () => Promise<void> | void,
  setBusy: (value: string | undefined) => void
) {
  setBusy(label)
  try {
    await action()
    await onRefresh()
    toast.success(actionSuccess(label))
    if (close) onOpenChange(false)
  } catch (error) {
    reportConflictError(error, onError)
  } finally {
    setBusy(undefined)
  }
}

function reportConflictError(
  error: unknown,
  onError: (message: string) => void
) {
  const message = error instanceof Error ? error.message : "Git conflict error"
  onError(message)
  toast.error(message)
}

function conflictStatusLabel(file: GitStatusFile) {
  const status = `${file.indexStatus}${file.worktreeStatus}`
  if (status === "UU") return "both modified"
  if (status === "AA") return "both added"
  if (status === "DD") return "both deleted"
  if (status === "AU") return "added by us"
  if (status === "UA") return "added by them"
  if (status === "DU") return "deleted by us"
  if (status === "UD") return "deleted by them"
  return "conflict"
}

function actionSuccess(label: string) {
  if (label.endsWith("ing")) return `${label.slice(0, -3)}ed.`
  return `${label}.`
}
