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

export function GitPage() {
  const platform = usePlatform()
  const projects = useProjects()
  const root = projects.activeProject?.path
  const git = useGitController(root, platform.workspace)

  if (!root || !platform.workspace) return <GitUnavailable />

  return (
    <div className="flex h-[calc(100vh-var(--header-height))] min-h-0 flex-col overflow-hidden bg-background">
      {git.error ? (
        <GitError message={git.error} onDismiss={git.clearError} />
      ) : null}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto border-t xl:grid-cols-[22rem_minmax(0,1fr)_30rem] xl:overflow-hidden">
        <GitWorkspacePanel
          busy={git.busy}
          commitMessage={git.commitMessage}
          loading={git.loading}
          selected={git.selected}
          status={git.status}
          onCommit={git.commit}
          onCommitMessageChange={git.setCommitMessage}
          onCommitPush={git.commitPush}
          onFileSelect={git.setSelected}
          onRefresh={git.refresh}
          onStageAll={git.stageAll}
          onStageFile={git.stageFile}
          onUnstageAll={git.unstageAll}
          onUnstageFile={git.unstageFile}
        />
        <GitHistoryPanel
          commits={git.commits}
          loading={git.loading}
          query={git.query}
          selected={git.selected}
          onCommitSelect={git.setSelected}
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
  const [diff, setDiff] = React.useState("")
  const [diffLoading, setDiffLoading] = React.useState(false)
  const [error, setError] = React.useState("")
  const [loading, setLoading] = React.useState(Boolean(root && workspace))
  const [query, setQuery] = React.useState("")
  const [selected, setSelected] = React.useState<GitSelection>()
  const [status, setStatus] = React.useState<GitStatusResult>()

  const refresh = React.useCallback(async () => {
    if (!root || !workspace) return
    setLoading(true)
    try {
      const [nextStatus, nextCommits] = await Promise.all([
        workspace.gitStatus({ root }),
        workspace.gitLog({ root, limit: 250 }),
      ])
      setStatus(nextStatus)
      setCommits(nextCommits)
      setSelected((current) =>
        resolveSelection(current, nextStatus, nextCommits)
      )
    } catch (error) {
      setError(errorText(error))
    } finally {
      setLoading(false)
    }
  }, [root, workspace])

  React.useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  React.useEffect(() => {
    return loadSelectionDiff(
      root,
      workspace,
      selected,
      setDiff,
      setDiffLoading,
      setError
    )
  }, [root, selected, workspace])

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

  return {
    busy,
    commit: () =>
      runAction("Committing", commitAction(commitMessage, setCommitMessage)),
    commitMessage,
    commitPush: () =>
      runAction(
        "Committing and pushing",
        commitPushAction(commitMessage, setCommitMessage)
      ),
    commits,
    diff,
    diffLoading,
    error,
    loading,
    query,
    refresh: () => void refresh(),
    selected,
    setCommitMessage,
    setQuery,
    setSelected,
    stageAll: () => runAction("Staging files", stageAllAction(status)),
    stageFile: (path: string) =>
      runAction("Staging file", stageFileAction(path, setSelected)),
    status,
    unstageAll: () => runAction("Unstaging files", unstageAllAction(status)),
    unstageFile: (path: string) =>
      runAction("Unstaging file", unstageFileAction(path, setSelected)),
    clearError: () => setError(""),
  }
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
  const workspaceFile = status.files.find((file) => file.unstaged)
  if (workspaceFile) return gitFileSelection(workspaceFile.path, false)
  const stagedFile = status.files.find((file) => file.staged)
  if (stagedFile) return gitFileSelection(stagedFile.path, true)
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

function stageFileAction(
  path: string,
  setSelected: (selection: GitSelection) => void
): GitAction {
  return async (root, workspace) => {
    await workspace.gitStageFiles({ root, paths: [path] })
    setSelected(gitFileSelection(path, true))
  }
}

function unstageFileAction(
  path: string,
  setSelected: (selection: GitSelection) => void
): GitAction {
  return async (root, workspace) => {
    await workspace.gitUnstageFiles({ root, paths: [path] })
    setSelected(gitFileSelection(path, false))
  }
}

function stageAllAction(status?: GitStatusResult): GitAction {
  return (root, workspace) =>
    workspace.gitStageFiles({ root, paths: changedPaths(status, "unstaged") })
}

function unstageAllAction(status?: GitStatusResult): GitAction {
  return (root, workspace) =>
    workspace.gitUnstageFiles({ root, paths: changedPaths(status, "staged") })
}

function commitAction(
  message: string,
  setCommitMessage: (value: string) => void
): GitAction {
  return async (root, workspace) => {
    await workspace.gitCommit({ root, message })
    setCommitMessage("")
  }
}

function commitPushAction(
  message: string,
  setCommitMessage: (value: string) => void
): GitAction {
  return async (root, workspace) => {
    await workspace.gitCommit({ root, message })
    setCommitMessage("")
    await workspace.gitPush({ root })
  }
}

function changedPaths(
  status: GitStatusResult | undefined,
  key: "staged" | "unstaged"
) {
  return (
    status?.files.filter((file) => file[key]).map((file) => file.path) ?? []
  )
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
  if (label === "Staging files") return "Files staged"
  if (label === "Unstaging files") return "Files unstaged"
  if (label === "Staging file") return "File staged"
  if (label === "Unstaging file") return "File unstaged"
  return "Git action completed"
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return "Git operation failed"
}
