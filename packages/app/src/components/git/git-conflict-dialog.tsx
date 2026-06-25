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
import { cn } from "@/lib/utils"

type MergeChoice = "base" | "current" | "incoming" | "none"

type MergeRow =
  | {
      id: string
      incoming?: string
      incomingLine?: number
      result: string
      resultLine: number
      current?: string
      currentLine?: number
      type: "context"
    }
  | {
      base?: string
      id: string
      incoming?: string
      incomingLine?: number
      row: number
      resultLine: number
      section: number
      current?: string
      currentLine?: number
      type: "conflict"
    }

type MergeDocument = {
  finalNewline: boolean
  rows: MergeRow[]
}

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
  const state = useConflictDialogState({
    conflicts,
    onError,
    open,
    root,
    workspace,
  })
  const actions = useConflictActions({
    choices: state.choices,
    document: state.document,
    onError,
    onOpenChange,
    onRefresh,
    root,
    selectedPath: state.activePath,
    setBusy: state.setBusy,
    setChoices: state.setChoices,
    workspace,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[92vh] max-h-[92vh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-0 sm:max-w-[calc(100vw-3rem)]">
        <ConflictHeader conflicts={conflicts} />
        <div className="grid min-h-0 grid-cols-1 overflow-hidden lg:grid-cols-[20rem_minmax(0,1fr)]">
          <ConflictFileList
            conflicts={conflicts}
            selectedPath={state.activePath}
            onSelect={state.setSelectedPath}
          />
          <ConflictResolutionView
            choices={state.choices}
            document={state.document}
            file={state.selectedFile}
            loading={state.loading}
            onSelectLine={state.selectLine}
          />
        </div>
        <ConflictFooter
          busy={state.busy}
          canApply={Boolean(state.document && state.activePath)}
          canContinue={conflicts.length === 0 && Boolean(root && workspace)}
          disabled={state.disabled}
          onAbort={actions.abort}
          onAcceptCurrent={actions.acceptCurrent}
          onAcceptIncoming={actions.acceptIncoming}
          onApply={actions.apply}
          onContinue={actions.continueGit}
        />
      </DialogContent>
    </Dialog>
  )
}

function ConflictHeader({ conflicts }: { conflicts: GitStatusFile[] }) {
  return (
    <DialogHeader className="border-b px-5 py-4">
      <div className="flex min-w-0 items-center gap-2">
        <AlertTriangleIcon className="size-4 shrink-0 text-amber-500" />
        <DialogTitle>Merge conflicts</DialogTitle>
        <Badge variant="outline">{conflicts.length} remaining</Badge>
      </div>
      <DialogDescription>
        Select current or incoming lines, then apply the resolved file.
      </DialogDescription>
    </DialogHeader>
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
    <aside className="min-h-0 overflow-auto border-b bg-muted/20 lg:border-r lg:border-b-0">
      <div className="grid gap-1 p-3">
        {conflicts.length === 0 ? <ResolvedConflictState /> : null}
        {conflicts.map((file) => (
          <ConflictFileButton
            file={file}
            key={file.path}
            selected={selectedPath === file.path}
            onSelect={onSelect}
          />
        ))}
      </div>
    </aside>
  )
}

function ConflictFileButton({
  file,
  onSelect,
  selected,
}: {
  file: GitStatusFile
  onSelect(path: string): void
  selected: boolean
}) {
  return (
    <button
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted",
        selected && "bg-muted"
      )}
      type="button"
      onClick={() => onSelect(file.path)}
    >
      <span className="min-w-0 flex-1 truncate">{file.path}</span>
      <Badge className="shrink-0" variant="outline">
        {conflictStatusLabel(file)}
      </Badge>
    </button>
  )
}

function ConflictResolutionView({
  choices,
  document,
  file,
  loading,
  onSelectLine,
}: {
  choices: Record<string, MergeChoice>
  document?: MergeDocument
  file?: GitStatusFile
  loading: boolean
  onSelectLine(row: MergeRow, choice: MergeChoice): void
}) {
  if (!file) return <AllResolvedState />
  if (loading || !document) return <ConflictLoadingState file={file} />

  return (
    <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      <MergeTitle file={file} />
      <MergeEditor
        choices={choices}
        document={document}
        path={file.path}
        onSelectLine={onSelectLine}
      />
    </section>
  )
}

function MergeTitle({ file }: { file: GitStatusFile }) {
  return (
    <div className="flex min-w-0 items-center gap-3 border-b px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{file.path}</div>
        <div className="text-xs text-muted-foreground">
          Choose current or incoming lines.
        </div>
      </div>
      <Badge variant="outline">{conflictStatusLabel(file)}</Badge>
    </div>
  )
}

function MergeEditor({
  choices,
  document,
  onSelectLine,
  path,
}: {
  choices: Record<string, MergeChoice>
  document: MergeDocument
  onSelectLine(row: MergeRow, choice: MergeChoice): void
  path: string
}) {
  return (
    <div className="min-h-0 overflow-auto bg-background font-mono text-xs leading-5">
      <div className="min-w-[64rem]">
        <MergeColumnHeader path={path} />
        <pre className="m-0 min-w-full p-0">
          {document.rows.map((row) => (
            <MergeEditorRow
              choice={mergeRowChoice(row, choices)}
              key={row.id}
              row={row}
              onSelectLine={onSelectLine}
            />
          ))}
        </pre>
      </div>
    </div>
  )
}

function MergeColumnHeader({ path }: { path: string }) {
  return (
    <div className="sticky top-0 z-10 grid grid-cols-3 border-b bg-background/95 backdrop-blur">
      <MergeHeaderCell label="Changes from current" />
      <MergeHeaderCell label={`Result ${path}`} />
      <MergeHeaderCell label="Changes from incoming" />
    </div>
  )
}

function MergeHeaderCell({ label }: { label: string }) {
  return (
    <div className="min-w-0 border-r px-3 py-2 last:border-r-0">
      <div className="truncate font-sans text-xs font-medium">{label}</div>
    </div>
  )
}

function MergeEditorRow({
  choice,
  onSelectLine,
  row,
}: {
  choice: MergeChoice
  onSelectLine(row: MergeRow, choice: MergeChoice): void
  row: MergeRow
}) {
  const result = mergeRowResult(row, choice)

  return (
    <div className="grid min-w-full grid-cols-3">
      <MergeLineCell
        active={choice === "current"}
        line={row.current}
        lineNumber={row.currentLine}
        side="current"
        type={row.type}
        onIgnore={() => onSelectLine(row, "none")}
        onSelect={() => onSelectLine(row, "current")}
      />
      <MergeResultCell
        line={result}
        lineNumber={result === undefined ? undefined : resultLineNumber(row)}
        type={row.type}
      />
      <MergeLineCell
        active={choice === "incoming"}
        line={row.incoming}
        lineNumber={row.incomingLine}
        side="incoming"
        type={row.type}
        onIgnore={() => onSelectLine(row, "none")}
        onSelect={() => onSelectLine(row, "incoming")}
      />
    </div>
  )
}

function MergeLineCell({
  active,
  line,
  lineNumber,
  onIgnore,
  onSelect,
  side,
  type,
}: {
  active: boolean
  line?: string
  lineNumber?: number
  onIgnore(): void
  onSelect(): void
  side: "current" | "incoming"
  type: MergeRow["type"]
}) {
  const selectable = type === "conflict" && line !== undefined

  return (
    <div
      className={cn(
        "grid h-5 min-w-0 grid-cols-[3rem_3rem_minmax(0,1fr)] border-r",
        mergeSideClassName(type, side, active)
      )}
    >
      <span className="px-1.5 text-right text-muted-foreground/70">
        {lineNumber ?? ""}
      </span>
      <MergeLineActions
        selectable={selectable}
        side={side}
        onIgnore={onIgnore}
        onSelect={onSelect}
      />
      <button
        className={cn(
          "min-w-0 overflow-hidden px-2 text-left whitespace-pre",
          selectable && "cursor-pointer hover:bg-blue-500/10",
          !selectable && "cursor-default"
        )}
        disabled={!selectable}
        type="button"
        onClick={onSelect}
      >
        <code>{line ?? " "}</code>
      </button>
    </div>
  )
}

function MergeLineActions({
  onIgnore,
  onSelect,
  selectable,
  side,
}: {
  onIgnore(): void
  onSelect(): void
  selectable: boolean
  side: "current" | "incoming"
}) {
  if (!selectable) return <span />
  const arrow = <MergeLineAction label={sideMarker(side)} onClick={onSelect} />
  const ignore = <MergeLineAction label="x" onClick={onIgnore} />
  return (
    <span className="flex items-center justify-center gap-0.5 text-muted-foreground/70">
      {side === "current" ? ignore : arrow}
      {side === "current" ? arrow : ignore}
    </span>
  )
}

function MergeLineAction({
  label,
  onClick,
}: {
  label: string
  onClick(): void
}) {
  return (
    <button
      className="h-5 min-w-4 px-0.5 text-center hover:text-foreground"
      type="button"
      onClick={onClick}
    >
      {label}
    </button>
  )
}

function MergeResultCell({
  line,
  lineNumber,
  type,
}: {
  line?: string
  lineNumber?: number
  type: MergeRow["type"]
}) {
  return (
    <div
      className={cn(
        "grid h-5 min-w-0 grid-cols-[3rem_3rem_minmax(0,1fr)] border-r",
        type === "conflict" && "bg-blue-500/10"
      )}
    >
      <span className="px-1.5 text-right text-muted-foreground/70">
        {lineNumber ?? ""}
      </span>
      <span className="text-center text-muted-foreground/70">
        {type === "conflict" ? "=" : ""}
      </span>
      <code className="min-w-0 overflow-hidden px-2 whitespace-pre">
        {line ?? " "}
      </code>
    </div>
  )
}

function ConflictFooter({
  busy,
  canApply,
  canContinue,
  disabled,
  onAbort,
  onAcceptCurrent,
  onAcceptIncoming,
  onApply,
  onContinue,
}: {
  busy?: string
  canApply: boolean
  canContinue: boolean
  disabled: boolean
  onAbort(): void
  onAcceptCurrent(): void
  onAcceptIncoming(): void
  onApply(): void
  onContinue(): void
}) {
  return (
    <DialogFooter className="mx-0 mb-0 items-center gap-2 rounded-none bg-muted/30 px-5 py-3">
      <div className="mr-auto flex min-w-0 items-center gap-2">
        <Button
          disabled={disabled || !canApply}
          type="button"
          variant="outline"
          onClick={onAcceptCurrent}
        >
          Accept current
        </Button>
        <Button
          disabled={disabled || !canApply}
          type="button"
          variant="outline"
          onClick={onAcceptIncoming}
        >
          Accept incoming
        </Button>
        {busy ? (
          <span className="truncate text-xs text-muted-foreground">{busy}</span>
        ) : null}
      </div>
      <Button
        disabled={disabled}
        type="button"
        variant="destructive"
        onClick={onAbort}
      >
        <XCircleIcon />
        Abort
      </Button>
      <Button disabled={disabled || !canApply} type="button" onClick={onApply}>
        <CheckCircle2Icon />
        Apply
      </Button>
      <Button
        disabled={!canContinue || Boolean(busy)}
        type="button"
        onClick={onContinue}
      >
        <GitMergeIcon />
        Continue
      </Button>
    </DialogFooter>
  )
}

function useConflictDialogState({
  conflicts,
  onError,
  open,
  root,
  workspace,
}: {
  conflicts: GitStatusFile[]
  onError(message: string): void
  open: boolean
  root?: string
  workspace?: WorkspaceClient
}) {
  const [busy, setBusy] = React.useState<string>()
  const [choices, setChoices] = React.useState<Record<string, MergeChoice>>({})
  const [conflict, setConflict] = React.useState<GitConflictFile>()
  const [selectedPath, setSelectedPath] = React.useState<string>()
  const activePath = activeConflictPath(conflicts, selectedPath)
  const selectedFile = conflicts.find((file) => file.path === activePath)
  const activeConflict = conflict?.path === activePath ? conflict : undefined
  const document = React.useMemo(
    () => (activeConflict ? parseMergeDocument(activeConflict) : undefined),
    [activeConflict]
  )
  const loading = Boolean(open && activePath && !activeConflict)
  const disabled = Boolean(busy) || loading || !root || !workspace

  useLoadConflict({
    activePath,
    onError,
    open,
    root,
    setChoices,
    setConflict,
    workspace,
  })

  return {
    activePath,
    busy,
    choices,
    disabled,
    document,
    loading,
    selectedFile,
    selectLine: selectMergeLine(setChoices),
    setBusy,
    setChoices,
    setSelectedPath,
  }
}

function useLoadConflict({
  activePath,
  onError,
  open,
  root,
  setChoices,
  setConflict,
  workspace,
}: {
  activePath?: string
  onError(message: string): void
  open: boolean
  root?: string
  setChoices(value: Record<string, MergeChoice>): void
  setConflict(value: GitConflictFile): void
  workspace?: WorkspaceClient
}) {
  React.useEffect(() => {
    if (!open || !root || !workspace || !activePath) return
    let cancelled = false
    workspace
      .gitConflictFile({ root, path: activePath })
      .then((nextConflict) => {
        if (cancelled) return
        setConflict(nextConflict)
        setChoices(initialMergeChoices(parseMergeDocument(nextConflict)))
      })
      .catch((error) => {
        if (!cancelled) reportConflictError(error, onError)
      })
    return () => {
      cancelled = true
    }
  }, [activePath, onError, open, root, setChoices, setConflict, workspace])
}

function useConflictActions({
  choices,
  document,
  onError,
  onOpenChange,
  onRefresh,
  root,
  selectedPath,
  setBusy,
  setChoices,
  workspace,
}: {
  choices: Record<string, MergeChoice>
  document?: MergeDocument
  onError(message: string): void
  onOpenChange(open: boolean): void
  onRefresh(): Promise<void> | void
  root?: string
  selectedPath?: string
  setBusy(value: string | undefined): void
  setChoices(value: React.SetStateAction<Record<string, MergeChoice>>): void
  workspace?: WorkspaceClient
}) {
  const apply = () => {
    if (!document || !root || !workspace || !selectedPath) return
    void runConflictAction(
      "Applying resolution",
      () =>
        workspace.gitResolveConflictFile({
          root,
          path: selectedPath,
          content: mergeDocumentContent(document, choices),
        }),
      false,
      onError,
      onOpenChange,
      onRefresh,
      setBusy
    )
  }
  return conflictActionHandlers({
    apply,
    document,
    onError,
    onOpenChange,
    onRefresh,
    root,
    setBusy,
    setChoices,
    workspace,
  })
}

function conflictActionHandlers(input: {
  apply(): void
  document?: MergeDocument
  onError(message: string): void
  onOpenChange(open: boolean): void
  onRefresh(): Promise<void> | void
  root?: string
  setBusy(value: string | undefined): void
  setChoices(value: React.SetStateAction<Record<string, MergeChoice>>): void
  workspace?: WorkspaceClient
}) {
  return {
    abort: gitOperationAction(input, "Aborting Git operation", "abort", true),
    acceptCurrent: () =>
      setAllChoices(input.document, input.setChoices, "current"),
    acceptIncoming: () =>
      setAllChoices(input.document, input.setChoices, "incoming"),
    apply: input.apply,
    continueGit: gitOperationAction(
      input,
      "Continuing Git operation",
      "continue",
      true
    ),
  }
}

function gitOperationAction(
  input: {
    onError(message: string): void
    onOpenChange(open: boolean): void
    onRefresh(): Promise<void> | void
    root?: string
    setBusy(value: string | undefined): void
    workspace?: WorkspaceClient
  },
  label: string,
  command: "abort" | "continue",
  close: boolean
) {
  return () => {
    if (!input.root || !input.workspace) return
    void runConflictAction(
      label,
      () =>
        command === "abort"
          ? input.workspace!.gitAbortConflict({ root: input.root! })
          : input.workspace!.gitContinueConflict({ root: input.root! }),
      close,
      input.onError,
      input.onOpenChange,
      input.onRefresh,
      input.setBusy
    )
  }
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

function parseMergeDocument(conflict: GitConflictFile): MergeDocument {
  return parseMergeLines(
    splitTextLines(conflict.result),
    splitTextLines(conflict.base),
    conflict
  )
}

function parseMergeLines(
  lines: string[],
  baseLines: string[],
  conflict: GitConflictFile
) {
  const state = createMergeParserState()
  while (state.index < lines.length) {
    if (lines[state.index].startsWith("<<<<<<<")) {
      parseMergeConflict(lines, baseLines, state)
    } else {
      pushContextMergeRow(lines[state.index], state)
      state.index += 1
    }
  }
  return { finalNewline: hasFinalNewline(conflict.result), rows: state.rows }
}

function parseMergeConflict(
  lines: string[],
  baseLines: string[],
  state: MergeParserState
) {
  const current = collectConflictLines(lines, state.index + 1, "=======")
  const incoming = collectConflictLines(lines, current.next + 1, ">>>>>>>")
  const base = baseLines.slice(
    state.baseLine - 1,
    state.baseLine - 1 + current.lines.length
  )
  pushConflictMergeRows(current.lines, incoming.lines, base, state)
  state.index = incoming.next + 1
}

function collectConflictLines(lines: string[], start: number, marker: string) {
  const collected: string[] = []
  let index = start
  while (index < lines.length && !lines[index].startsWith(marker)) {
    collected.push(lines[index])
    index += 1
  }
  return { lines: collected, next: index }
}

type MergeParserState = {
  baseLine: number
  currentLine: number
  index: number
  incomingLine: number
  resultLine: number
  rows: MergeRow[]
  section: number
}

function createMergeParserState(): MergeParserState {
  return {
    baseLine: 1,
    currentLine: 1,
    incomingLine: 1,
    index: 0,
    resultLine: 1,
    rows: [],
    section: 0,
  }
}

function pushContextMergeRow(line: string, state: MergeParserState) {
  state.rows.push({
    current: line,
    currentLine: state.currentLine,
    id: `context:${state.index}`,
    incoming: line,
    incomingLine: state.incomingLine,
    result: line,
    resultLine: state.resultLine,
    type: "context",
  })
  state.baseLine += 1
  state.currentLine += 1
  state.incomingLine += 1
  state.resultLine += 1
}

function pushConflictMergeRows(
  current: string[],
  incoming: string[],
  base: string[],
  state: MergeParserState
) {
  const section = state.section
  const count = Math.max(current.length, incoming.length, base.length, 1)
  for (let row = 0; row < count; row += 1) {
    state.rows.push(
      conflictMergeRow(current, incoming, base, state, section, row)
    )
  }
  state.baseLine += Math.max(base.length, count)
  state.currentLine += current.length
  state.incomingLine += incoming.length
  state.resultLine += count
  state.section += 1
}

function conflictMergeRow(
  current: string[],
  incoming: string[],
  base: string[],
  state: MergeParserState,
  section: number,
  row: number
): MergeRow {
  return {
    base: base[row],
    current: current[row],
    currentLine: lineNumberAt(state.currentLine, row, current),
    id: `conflict:${section}:${row}`,
    incoming: incoming[row],
    incomingLine: lineNumberAt(state.incomingLine, row, incoming),
    row,
    resultLine: state.resultLine + row,
    section,
    type: "conflict",
  }
}

function initialMergeChoices(document: MergeDocument) {
  const choices: Record<string, MergeChoice> = {}
  for (const row of document.rows) {
    if (row.type === "conflict") choices[row.id] = initialMergeChoice(row)
  }
  return choices
}

function initialMergeChoice(row: Extract<MergeRow, { type: "conflict" }>) {
  if (row.base !== undefined) return "base"
  if (row.current !== undefined) return "current"
  return "incoming"
}

function mergeDocumentContent(
  document: MergeDocument,
  choices: Record<string, MergeChoice>
) {
  const lines = document.rows.flatMap((row) => mergeRowContent(row, choices))
  return `${lines.join("\n")}${document.finalNewline ? "\n" : ""}`
}

function mergeRowContent(row: MergeRow, choices: Record<string, MergeChoice>) {
  const result = mergeRowResult(row, mergeRowChoice(row, choices))
  return result === undefined ? [] : [result]
}

function mergeRowChoice(row: MergeRow, choices: Record<string, MergeChoice>) {
  if (row.type === "context") return "base"
  return choices[row.id] ?? initialMergeChoice(row)
}

function mergeRowResult(row: MergeRow, choice: MergeChoice) {
  if (row.type === "context") return row.result
  if (choice === "none") return undefined
  if (choice === "current") return row.current
  if (choice === "incoming") return row.incoming
  return row.base
}

function resultLineNumber(row: MergeRow) {
  return row.resultLine
}

function selectMergeLine(
  setChoices: React.Dispatch<React.SetStateAction<Record<string, MergeChoice>>>
) {
  return (row: MergeRow, choice: MergeChoice) => {
    if (row.type !== "conflict") return
    setChoices((current) => ({ ...current, [row.id]: choice }))
  }
}

function setAllChoices(
  document: MergeDocument | undefined,
  setChoices: React.Dispatch<React.SetStateAction<Record<string, MergeChoice>>>,
  choice: MergeChoice
) {
  if (!document) return
  setChoices((current) => {
    const next = { ...current }
    for (const row of document.rows) {
      if (row.type === "conflict" && mergeChoiceAvailable(row, choice))
        next[row.id] = choice
    }
    return next
  })
}

function mergeChoiceAvailable(row: MergeRow, choice: MergeChoice) {
  if (row.type === "context") return false
  return mergeRowResult(row, choice) !== undefined
}

function activeConflictPath(conflicts: GitStatusFile[], selectedPath?: string) {
  if (selectedPath && conflicts.some((file) => file.path === selectedPath))
    return selectedPath
  return conflicts[0]?.path
}

function splitTextLines(value: string) {
  const normalized = value.replace(/\r\n/g, "\n")
  const lines = normalized.split("\n")
  if (normalized.endsWith("\n")) lines.pop()
  return lines
}

function hasFinalNewline(value: string) {
  return value.endsWith("\n")
}

function lineNumberAt(start: number, offset: number, lines: string[]) {
  return lines[offset] === undefined ? undefined : start + offset
}

function mergeSideClassName(
  type: MergeRow["type"],
  side: "current" | "incoming",
  active: boolean
) {
  if (type === "context") return "bg-background"
  if (active) return "bg-blue-500/15"
  return side === "current" ? "bg-destructive/10" : "bg-emerald-500/10"
}

function sideMarker(side: "current" | "incoming") {
  return side === "current" ? ">>" : "<<"
}

function AllResolvedState() {
  return (
    <div className="flex min-h-0 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
      <CheckCircle2Icon className="size-8 text-emerald-500" />
      <div>All conflicts are resolved.</div>
    </div>
  )
}

function ConflictLoadingState({ file }: { file: GitStatusFile }) {
  return (
    <div className="flex min-h-0 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
      <RotateCcwIcon className="size-7 animate-spin" />
      <div>Loading {file.path}</div>
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
