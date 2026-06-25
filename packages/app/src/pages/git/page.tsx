import * as React from "react"
import { toast } from "sonner"

import type {
  GitLogCommit,
  GitStatusResult,
  WorkspaceClient,
} from "@/context/platform"
import { usePlatform } from "@/context/platform"
import { useProjects } from "@/context/projects"
import { GitHistoryPanel } from "@/components/git/git-history-panel"
import { GitInspectorPanel } from "@/components/git/git-inspector-panel"
import { GitWorkspacePanel } from "@/components/git/git-workspace-panel"
import type { GitSelection } from "@/components/git/git-types"
import {
  gitCommitSelection,
  gitFileSelection,
} from "@/components/git/git-types"
import { Button } from "@/components/ui/button"

type GitAction = (root: string, workspace: WorkspaceClient) => Promise<unknown>
type GitRefreshOptions = {
  quiet?: boolean
}

type LoadMoreGitCommitsInput = {
  commitsRef: React.RefObject<GitLogCommit[]>
  commitTotalRef: React.RefObject<number | undefined>
  hasMoreCommitsRef: React.RefObject<boolean>
  loadedCommitCountRef: React.RefObject<number>
  loadingMoreCommitsRef: React.RefObject<boolean>
  root: string | undefined
  setCommits: React.Dispatch<React.SetStateAction<GitLogCommit[]>>
  setError(value: string): void
  setHasMoreCommits(value: boolean): void
  setLoadingMoreCommits(value: boolean): void
  workspace: WorkspaceClient | undefined
}

const gitMonitorDelayMs = 1_500
const gitMonitorHiddenDelayMs = 5_000
const gitMonitorFocusDelayMs = 250
const gitLogPageSize = 100

export function GitPage() {
  const platform = usePlatform()
  const projects = useProjects()
  const root = projects.activeProject?.path
  const git = useGitController(root, platform.workspace)

  if (!root || !platform.workspace) return <GitUnavailable />

  return (
    <div className="flex h-[calc(100svh_-_var(--header-height))] min-h-0 min-w-0 flex-col overflow-hidden bg-background md:h-[calc(100svh_-_var(--header-height)_-_1rem)]">
      {git.error ? (
        <GitError message={git.error} onDismiss={git.clearError} />
      ) : null}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto xl:grid-cols-[18rem_minmax(22rem,30rem)_minmax(0,1fr)] xl:overflow-hidden">
        <GitWorkspacePanel
          busy={git.busy}
          commitMessage={git.commitMessage}
          loading={git.loading}
          selected={git.selected}
          selectedFilePaths={git.selectedFilePaths}
          status={git.status}
          onCommit={git.commit}
          onCommitMessageChange={git.setCommitMessage}
          onCommitPush={git.commitPush}
          onClearSelection={git.clearFileSelection}
          onDeleteFile={git.deleteFile}
          onFileSelect={git.setSelected}
          onGitAddFile={git.gitAddFile}
          onRefresh={git.refresh}
          onRollbackFile={git.rollbackFile}
          onSelectAll={git.selectAllFiles}
          onSelectFile={git.selectFile}
          onSelectFiles={git.selectFiles}
          onUnselectFile={git.unselectFile}
          onUnselectFiles={git.unselectFiles}
        />
        <GitHistoryPanel
          commits={git.commits}
          commitTotal={git.commitTotal}
          hasMoreCommits={git.hasMoreCommits}
          loading={git.loading}
          loadingMore={git.loadingMoreCommits}
          query={git.query}
          selected={git.selected}
          onCommitSelect={git.setSelected}
          onLoadMore={git.loadMoreCommits}
          onQueryChange={git.setQuery}
        />
        <GitInspectorPanel
          commits={git.commits}
          diff={git.diff}
          diffLoading={git.diffLoading}
          selected={git.selected}
          status={git.status}
        />
      </div>
    </div>
  )
}

function useGitController(root?: string, workspace?: WorkspaceClient) {
  const [busy, setBusy] = React.useState<string>()
  const [commitMessage, setCommitMessage] = React.useState("")
  const [commits, setCommits] = React.useState<GitLogCommit[]>([])
  const [commitTotal, setCommitTotal] = React.useState<number>()
  const [diff, setDiff] = React.useState("")
  const [diffLoading, setDiffLoading] = React.useState(false)
  const [error, setError] = React.useState("")
  const [hasMoreCommits, setHasMoreCommits] = React.useState(true)
  const [loading, setLoading] = React.useState(Boolean(root && workspace))
  const [loadingMoreCommits, setLoadingMoreCommits] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [selected, setSelected] = React.useState<GitSelection>()
  const [selectedFilePaths, setSelectedFilePaths] = React.useState(
    () => new Set<string>()
  )
  const [status, setStatus] = React.useState<GitStatusResult>()
  const [stateVersion, setStateVersion] = React.useState(0)
  const busyRef = React.useRef<string>()
  const commitsRef = React.useRef<GitLogCommit[]>([])
  const commitTotalRef = React.useRef<number>()
  const diffRef = React.useRef("")
  const fileSelectionInitialized = React.useRef(false)
  const hasMoreCommitsRef = React.useRef(true)
  const loadedCommitCountRef = React.useRef(gitLogPageSize)
  const loadingMoreCommitsRef = React.useRef(false)
  const stateFingerprintRef = React.useRef("")

  const refresh = React.useCallback(
    async (options: GitRefreshOptions = {}) => {
      if (!root || !workspace) return
      if (!options.quiet) setLoading(true)
      try {
        const [nextStatus, nextCommits, nextCommitTotal] = await Promise.all([
          workspace.gitStatus({ root }),
          workspace.gitLog({ root, limit: loadedCommitCountRef.current }),
          gitCommitTotal(root, workspace),
        ])
        const nextFingerprint = gitStateFingerprint(nextStatus, nextCommits)
        const stateChanged = nextFingerprint !== stateFingerprintRef.current
        stateFingerprintRef.current = nextFingerprint
        loadedCommitCountRef.current = Math.max(
          gitLogPageSize,
          nextCommits.length
        )
        hasMoreCommitsRef.current = moreGitCommitsAvailable(
          nextCommits.length,
          loadedCommitCountRef.current,
          nextCommitTotal
        )
        commitTotalRef.current = nextCommitTotal
        setStatus(nextStatus)
        setCommits(nextCommits)
        setCommitTotal(nextCommitTotal)
        setHasMoreCommits(hasMoreCommitsRef.current)
        setSelected((current) =>
          resolveSelection(current, nextStatus, nextCommits)
        )
        if (stateChanged) setStateVersion((current) => current + 1)
      } catch (error) {
        setError(errorText(error))
      } finally {
        if (!options.quiet) setLoading(false)
      }
    },
    [root, workspace]
  )

  React.useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  React.useEffect(() => {
    fileSelectionInitialized.current = false
    loadedCommitCountRef.current = gitLogPageSize
    stateFingerprintRef.current = ""
  }, [root])

  React.useEffect(() => {
    busyRef.current = busy
  }, [busy])

  React.useEffect(() => {
    commitsRef.current = commits
  }, [commits])

  React.useEffect(() => {
    diffRef.current = diff
  }, [diff])

  React.useEffect(() => {
    hasMoreCommitsRef.current = hasMoreCommits
  }, [hasMoreCommits])

  React.useEffect(() => {
    loadingMoreCommitsRef.current = loadingMoreCommits
  }, [loadingMoreCommits])

  React.useEffect(() => {
    return startGitStateMonitor(
      root,
      workspace,
      busyRef,
      stateFingerprintRef,
      refresh
    )
  }, [refresh, root, workspace])

  React.useEffect(() => {
    return startSelectedDiffMonitor(
      root,
      workspace,
      selected,
      busyRef,
      diffRef,
      setDiff
    )
  }, [root, selected, workspace])

  React.useEffect(() => {
    if (!status) return
    const includeStaged = !fileSelectionInitialized.current
    fileSelectionInitialized.current = true
    setSelectedFilePaths((current) =>
      reconcileSelectedFilePaths(current, status, includeStaged)
    )
  }, [status])

  React.useEffect(() => {
    return loadSelectionDiff(
      root,
      workspace,
      selected,
      setDiff,
      setDiffLoading,
      setError
    )
  }, [root, selected, stateVersion, workspace])

  const runAction = React.useCallback(
    (label: string, action: GitAction) => {
      void runGitAction(
        label,
        action,
        root,
        workspace,
        refresh,
        setBusy,
        setError
      )
    },
    [refresh, root, workspace]
  )

  const loadMoreCommits = React.useCallback(
    () =>
      loadMoreGitCommits({
        commitTotalRef,
        root,
        workspace,
        commitsRef,
        hasMoreCommitsRef,
        loadingMoreCommitsRef,
        loadedCommitCountRef,
        setCommits,
        setError,
        setHasMoreCommits,
        setLoadingMoreCommits,
      }),
    [root, workspace]
  )

  return {
    busy,
    commit: () =>
      runAction(
        "Committing",
        commitAction(
          commitMessage,
          selectedFilePaths,
          status,
          setCommitMessage,
          setSelectedFilePaths
        )
      ),
    commitMessage,
    commitTotal,
    commitPush: () =>
      runAction(
        "Committing and pushing",
        commitPushAction(
          commitMessage,
          selectedFilePaths,
          status,
          setCommitMessage,
          setSelectedFilePaths
        )
      ),
    commits,
    diff,
    diffLoading,
    error,
    deleteFile: (path: string) =>
      runAction(
        "Deleting file",
        gitDeleteFileAction(path, setSelectedFilePaths)
      ),
    gitAddFile: (path: string) =>
      runAction(
        "Git add",
        gitAddFileAction(path, setSelected, setSelectedFilePaths)
      ),
    hasMoreCommits,
    loadMoreCommits,
    loading,
    loadingMoreCommits,
    query,
    refresh: () => void refresh(),
    rollbackFile: (path: string) =>
      runAction(
        "Rolling back file",
        gitRollbackFileAction(path, status, setSelectedFilePaths)
      ),
    selected,
    selectedFilePaths,
    setCommitMessage,
    setQuery,
    setSelected,
    selectAllFiles: () => setSelectedFilePaths(statusFilePathSet(status)),
    selectFile: (path: string) =>
      setSelectedFilePaths((current) => addFilePaths(current, [path])),
    selectFiles: (paths: string[]) =>
      setSelectedFilePaths((current) => addFilePaths(current, paths)),
    status,
    clearFileSelection: () => setSelectedFilePaths(new Set()),
    unselectFile: (path: string) =>
      setSelectedFilePaths((current) => removeFilePaths(current, [path])),
    unselectFiles: (paths: string[]) =>
      setSelectedFilePaths((current) => removeFilePaths(current, paths)),
    clearError: () => setError(""),
  }
}

function startGitStateMonitor(
  root: string | undefined,
  workspace: WorkspaceClient | undefined,
  busyRef: React.RefObject<string | undefined>,
  stateFingerprintRef: React.RefObject<string>,
  refresh: (options?: GitRefreshOptions) => Promise<void>
) {
  if (!root || !workspace) return
  return startGitMonitorTask(busyRef, () =>
    refreshIfGitChanged(root, workspace, stateFingerprintRef, refresh)
  )
}

function startSelectedDiffMonitor(
  root: string | undefined,
  workspace: WorkspaceClient | undefined,
  selected: GitSelection | undefined,
  busyRef: React.RefObject<string | undefined>,
  diffRef: React.RefObject<string>,
  setDiff: (value: string) => void
) {
  if (!root || !workspace || selected?.type !== "file") return
  return startGitMonitorTask(busyRef, () =>
    refreshSelectedDiff(root, workspace, selected, diffRef, setDiff)
  )
}

function startGitMonitorTask(
  busyRef: React.RefObject<string | undefined>,
  task: () => Promise<void>
) {
  let stopped = false
  let timer: number | undefined
  let checking = false
  const schedule = (delay: number) => {
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(() => void check(), delay)
  }
  const check = async () => {
    if (stopped) return
    if (gitMonitorPaused(busyRef.current, checking)) {
      schedule(gitMonitorPausedDelay())
      return
    }
    checking = true
    try {
      await task()
    } catch (error) {
      void error
    } finally {
      checking = false
      if (!stopped) schedule(gitMonitorDelayMs)
    }
  }
  const queueFastCheck = () => schedule(gitMonitorFocusDelayMs)
  schedule(gitMonitorDelayMs)
  window.addEventListener("focus", queueFastCheck)
  document.addEventListener("visibilitychange", queueFastCheck)
  return () => {
    stopped = true
    if (timer) window.clearTimeout(timer)
    window.removeEventListener("focus", queueFastCheck)
    document.removeEventListener("visibilitychange", queueFastCheck)
  }
}

function gitMonitorPaused(busy: string | undefined, checking: boolean) {
  return document.hidden || Boolean(busy) || checking
}

function gitMonitorPausedDelay() {
  return document.hidden ? gitMonitorHiddenDelayMs : gitMonitorDelayMs
}

async function refreshIfGitChanged(
  root: string,
  workspace: WorkspaceClient,
  stateFingerprintRef: React.RefObject<string>,
  refresh: (options?: GitRefreshOptions) => Promise<void>
) {
  const nextFingerprint = await gitMonitorFingerprint(root, workspace)
  if (nextFingerprint !== stateFingerprintRef.current) {
    await refresh({ quiet: true })
  }
}

async function refreshSelectedDiff(
  root: string,
  workspace: WorkspaceClient,
  selected: GitSelection,
  diffRef: React.RefObject<string>,
  setDiff: (value: string) => void
) {
  const nextDiff = await selectedDiff(root, workspace, selected)
  if (nextDiff === diffRef.current) return
  diffRef.current = nextDiff
  setDiff(nextDiff)
}

async function gitMonitorFingerprint(root: string, workspace: WorkspaceClient) {
  const [status, commits] = await Promise.all([
    workspace.gitStatus({ root }),
    workspace.gitLog({ root, limit: 1 }),
  ])
  return gitStateFingerprint(status, commits)
}

async function gitCommitTotal(root: string, workspace: WorkspaceClient) {
  if (!workspace.gitCommitCount) return undefined
  return workspace.gitCommitCount({ root })
}

function moreGitCommitsAvailable(
  loadedCount: number,
  requestedCount: number,
  totalCount: number | undefined
) {
  if (totalCount === undefined) return loadedCount >= requestedCount
  return loadedCount < totalCount
}

function gitStateFingerprint(status: GitStatusResult, commits: GitLogCommit[]) {
  return JSON.stringify({
    branch: status.branch,
    files: status.files,
    head: commits[0]?.hash ?? "",
  })
}

async function loadMoreGitCommits(input: LoadMoreGitCommitsInput) {
  const { root, workspace } = input
  if (!root || !workspace || !canLoadMoreGitCommits(input)) return
  input.loadingMoreCommitsRef.current = true
  input.setLoadingMoreCommits(true)
  try {
    const nextCommits = await workspace.gitLog({
      root,
      limit: gitLogPageSize,
      skip: input.commitsRef.current.length,
    })
    input.setCommits((current) => appendGitCommits(current, nextCommits))
    input.loadedCommitCountRef.current += nextCommits.length
    input.hasMoreCommitsRef.current = moreGitCommitsAvailable(
      input.loadedCommitCountRef.current,
      input.loadedCommitCountRef.current,
      input.commitTotalRef.current
    )
    if (nextCommits.length === 0) input.hasMoreCommitsRef.current = false
    input.setHasMoreCommits(input.hasMoreCommitsRef.current)
  } catch (error) {
    input.setError(errorText(error))
  } finally {
    input.loadingMoreCommitsRef.current = false
    input.setLoadingMoreCommits(false)
  }
}

function canLoadMoreGitCommits(input: LoadMoreGitCommitsInput) {
  return input.hasMoreCommitsRef.current && !input.loadingMoreCommitsRef.current
}

function appendGitCommits(
  current: GitLogCommit[],
  nextCommits: GitLogCommit[]
) {
  const hashes = new Set(current.map((commit) => commit.hash))
  const uniqueCommits = nextCommits.filter((commit) => !hashes.has(commit.hash))
  return [...current, ...uniqueCommits]
}

function loadSelectionDiff(
  root: string | undefined,
  workspace: WorkspaceClient | undefined,
  selected: GitSelection | undefined,
  setDiff: (value: string) => void,
  setDiffLoading: (value: boolean) => void,
  setError: (value: string) => void
) {
  if (!root || !workspace || !selected) {
    setDiff("")
    setDiffLoading(false)
    return
  }
  let cancelled = false
  setDiffLoading(true)
  selectedDiff(root, workspace, selected)
    .then((nextDiff) => {
      if (!cancelled) setDiff(nextDiff)
    })
    .catch((error) => {
      if (!cancelled) setError(errorText(error))
    })
    .finally(() => {
      if (!cancelled) setDiffLoading(false)
    })
  return () => {
    cancelled = true
  }
}

async function selectedDiff(
  root: string,
  workspace: WorkspaceClient,
  selected: GitSelection
) {
  if (selected.type === "commit") {
    return workspace.gitCommitDiff({ root, hash: selected.hash })
  }
  return workspace.gitFileDiff({
    root,
    path: selected.path,
    staged: selected.staged,
  })
}

async function runGitAction(
  label: string,
  action: GitAction,
  root: string | undefined,
  workspace: WorkspaceClient | undefined,
  refresh: () => Promise<void>,
  setBusy: (value: string | undefined) => void,
  setError: (value: string) => void
) {
  if (!root || !workspace) return
  setBusy(label)
  setError("")
  try {
    await action(root, workspace)
    await refresh()
    toast.success(actionSuccess(label))
  } catch (error) {
    const message = errorText(error)
    setError(message)
    toast.error(message)
  } finally {
    setBusy(undefined)
  }
}

function resolveSelection(
  selected: GitSelection | undefined,
  status: GitStatusResult,
  commits: GitLogCommit[]
) {
  if (selectionStillExists(selected, status, commits)) return selected
  const changeFile = status.files.find((file) => !file.untracked)
  if (changeFile) return gitFileSelection(changeFile.path, changeFile.staged)
  const unversionedFile = status.files.find((file) => file.untracked)
  if (unversionedFile) return gitFileSelection(unversionedFile.path, false)
  return commits[0] ? gitCommitSelection(commits[0].hash) : undefined
}

function selectionStillExists(
  selected: GitSelection | undefined,
  status: GitStatusResult,
  commits: GitLogCommit[]
) {
  if (!selected) return false
  if (selected.type === "commit")
    return commits.some((commit) => commit.hash === selected.hash)
  return status.files.some(
    (file) =>
      file.path === selected.path &&
      (selected.staged ? file.staged : file.unstaged)
  )
}

function gitAddFileAction(
  path: string,
  setSelected: (selection: GitSelection) => void,
  setSelectedFilePaths: React.Dispatch<React.SetStateAction<Set<string>>>
): GitAction {
  return async (root, workspace) => {
    await workspace.gitStageFiles({ root, paths: [path] })
    setSelected(gitFileSelection(path, true))
    setSelectedFilePaths((current) => addFilePaths(current, [path]))
  }
}

function gitRollbackFileAction(
  path: string,
  status: GitStatusResult | undefined,
  setSelectedFilePaths: React.Dispatch<React.SetStateAction<Set<string>>>
): GitAction {
  return async (root, workspace) => {
    if (gitAddedFile(status, path)) {
      await workspace.gitUnstageFiles({ root, paths: [path] })
    } else {
      await workspace.gitRollbackFiles({ root, paths: [path] })
    }
    setSelectedFilePaths((current) => removeFilePaths(current, [path]))
  }
}

function gitAddedFile(status: GitStatusResult | undefined, path: string) {
  return (
    status?.files.some(
      (file) => file.path === path && file.staged && file.status === "added"
    ) ?? false
  )
}

function gitDeleteFileAction(
  path: string,
  setSelectedFilePaths: React.Dispatch<React.SetStateAction<Set<string>>>
): GitAction {
  return async (root, workspace) => {
    await workspace.gitDeleteFiles({ root, paths: [path] })
    setSelectedFilePaths((current) => removeFilePaths(current, [path]))
  }
}

function commitAction(
  message: string,
  selectedFilePaths: ReadonlySet<string>,
  status: GitStatusResult | undefined,
  setCommitMessage: (value: string) => void,
  setSelectedFilePaths: (paths: Set<string>) => void
): GitAction {
  return async (root, workspace) => {
    await prepareSelectedFiles(root, workspace, status, selectedFilePaths)
    await workspace.gitCommit({ root, message })
    setCommitMessage("")
    setSelectedFilePaths(new Set())
  }
}

function commitPushAction(
  message: string,
  selectedFilePaths: ReadonlySet<string>,
  status: GitStatusResult | undefined,
  setCommitMessage: (value: string) => void,
  setSelectedFilePaths: (paths: Set<string>) => void
): GitAction {
  return async (root, workspace) => {
    await prepareSelectedFiles(root, workspace, status, selectedFilePaths)
    await workspace.gitCommit({ root, message })
    setCommitMessage("")
    setSelectedFilePaths(new Set())
    await workspace.gitPush({ root })
  }
}

async function prepareSelectedFiles(
  root: string,
  workspace: WorkspaceClient,
  status: GitStatusResult | undefined,
  selectedFilePaths: ReadonlySet<string>
) {
  const pathsToStage = selectedStatusPaths(status, selectedFilePaths)
  const pathsToUnstage = unselectedStagedPaths(status, selectedFilePaths)
  if (pathsToStage.length === 0)
    throw new Error("Select files before committing")
  if (pathsToUnstage.length > 0) {
    await workspace.gitUnstageFiles({ root, paths: pathsToUnstage })
  }
  await workspace.gitStageFiles({ root, paths: pathsToStage })
}

function selectedStatusPaths(
  status: GitStatusResult | undefined,
  selectedFilePaths: ReadonlySet<string>
) {
  return (
    status?.files
      .filter((file) => selectedFilePaths.has(file.path))
      .map((file) => file.path) ?? []
  )
}

function unselectedStagedPaths(
  status: GitStatusResult | undefined,
  selectedFilePaths: ReadonlySet<string>
) {
  return (
    status?.files
      .filter((file) => file.staged && !selectedFilePaths.has(file.path))
      .map((file) => file.path) ?? []
  )
}

function reconcileSelectedFilePaths(
  current: Set<string>,
  status: GitStatusResult,
  includeStaged: boolean
) {
  const statusPaths = statusFilePathSet(status)
  const next = new Set([...current].filter((path) => statusPaths.has(path)))
  if (includeStaged) addStagedFilePaths(next, status)
  return sameFilePathSet(current, next) ? current : next
}

function addStagedFilePaths(paths: Set<string>, status: GitStatusResult) {
  for (const file of status.files) {
    if (file.staged) paths.add(file.path)
  }
}

function statusFilePathSet(status: GitStatusResult | undefined) {
  return new Set(status?.files.map((file) => file.path) ?? [])
}

function addFilePaths(current: Set<string>, paths: string[]) {
  const next = new Set(current)
  for (const path of paths) next.add(path)
  return next
}

function removeFilePaths(current: Set<string>, paths: string[]) {
  const next = new Set(current)
  for (const path of paths) next.delete(path)
  return next
}

function sameFilePathSet(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) return false
  for (const path of left) {
    if (!right.has(path)) return false
  }
  return true
}

function GitError({
  message,
  onDismiss,
}: {
  message: string
  onDismiss(): void
}) {
  return (
    <div className="flex items-center gap-3 border-t border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <span className="min-w-0 flex-1 truncate">{message}</span>
      <Button size="sm" variant="ghost" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  )
}

function GitUnavailable() {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-md rounded-md border p-6 text-center">
        <h2 className="font-heading text-lg font-semibold">
          Git is unavailable
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Open Blame in the desktop workspace to use repository actions.
        </p>
      </div>
    </div>
  )
}

function actionSuccess(label: string) {
  if (label === "Committing") return "Commit created"
  if (label === "Committing and pushing") return "Commit pushed"
  if (label === "Deleting file") return "File deleted"
  if (label === "Git add") return "File added to Git"
  if (label === "Rolling back file") return "File changes rolled back"
  return "Git action completed"
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return "Git operation failed"
}
