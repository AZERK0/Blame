import type {
  GitLogCommit,
  GitStatusFile,
  GitStatusResult,
  WorkspaceClient,
} from "@/context/platform"
import * as React from "react"
import type { GitSelection } from "@/components/git/git-types"

export type GitRefreshOptions = {
  quiet?: boolean
}

const gitMonitorDelayMs = 1_500

const gitMonitorHiddenDelayMs = 5_000

const gitMonitorFocusDelayMs = 250

export function startGitStateMonitor(
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

export function startSelectedDiffMonitor(
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

export async function gitCommitTotal(root: string, workspace: WorkspaceClient) {
  if (!workspace.gitCommitCount) return undefined
  return workspace.gitCommitCount({ root })
}

export function gitConflictFiles(status: GitStatusResult | undefined) {
  return (
    status?.files.filter(
      (file) => file.conflicted || file.status === "conflict"
    ) ?? []
  )
}

export function gitConflictFingerprint(conflicts: GitStatusFile[]) {
  return conflicts
    .map((file) => `${file.indexStatus}${file.worktreeStatus}:${file.path}`)
    .join("\n")
}

export function gitStateFingerprint(status: GitStatusResult, commits: GitLogCommit[]) {
  return JSON.stringify({
    branch: status.branch,
    files: status.files,
    head: commits[0]?.hash ?? "",
  })
}

export async function selectedDiff(
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
