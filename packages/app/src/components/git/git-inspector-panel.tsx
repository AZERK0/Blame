import * as React from "react"
import type {
  GitLogCommit,
  GitStatusFile,
  GitStatusResult,
} from "@/context/platform"
import type { GitSelection } from "@/components/git/git-types"
import {
  gitDateLabel,
  gitRefClassName,
  gitStatusClassName,
  gitStatusLabel,
  shortGitHash,
} from "@/components/git/git-format"
import {
  normalizeDiffs,
  parseGitDiff,
} from "@/components/backlog/development/development-workspace"
import { DevelopmentDiffView } from "@/components/backlog/development/development-diff-view"
import { GitBranchIcon, GitCommitIcon, GitPullRequestIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export function GitInspectorPanel({
  commits,
  diff,
  diffLoading,
  selected,
  status,
}: {
  commits: GitLogCommit[]
  diff?: string
  diffLoading: boolean
  selected?: GitSelection
  status?: GitStatusResult
}) {
  const diffs = React.useMemo(
    () => normalizeDiffs(parseGitDiff(diff ?? "")),
    [diff]
  )

  return (
    <aside className="flex min-h-[34rem] min-w-0 flex-col bg-background xl:min-h-0">
      <InspectorHeader commits={commits} selected={selected} status={status} />
      <div className="min-h-0 flex-1">
        {diffLoading ? <DiffSkeleton /> : null}
        {!diffLoading && selected ? <DiffStack diffs={diffs} /> : null}
        {!diffLoading && !selected ? (
          <RepositoryOverview status={status} />
        ) : null}
      </div>
    </aside>
  )
}

function InspectorHeader({
  commits,
  selected,
  status,
}: {
  commits: GitLogCommit[]
  selected?: GitSelection
  status?: GitStatusResult
}) {
  if (selected?.type === "commit") {
    const commit = commits.find((item) => item.hash === selected.hash)
    return <CommitHeader commit={commit} />
  }
  if (selected?.type === "file") {
    const file = status?.files.find((item) => item.path === selected.path)
    return <FileHeader file={file} selected={selected} />
  }
  return <OverviewHeader status={status} />
}

function CommitHeader({ commit }: { commit?: GitLogCommit }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 border-b px-3 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <GitCommitIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">
          {commit?.message ?? "Commit"}
        </span>
      </div>
      {commit ? <CommitMeta commit={commit} /> : null}
    </div>
  )
}

function CommitMeta({ commit }: { commit: GitLogCommit }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 text-xs text-muted-foreground">
      <div className="truncate">
        {shortGitHash(commit.hash)} · {commit.authorName} ·{" "}
        {gitDateLabel(commit.date)}
      </div>
      <CommitRefBadges commit={commit} />
    </div>
  )
}

function CommitRefBadges({ commit }: { commit: GitLogCommit }) {
  if (commit.refs.length === 0) return null

  return (
    <div className="flex min-w-0 flex-wrap gap-1">
      {commit.refs.map((ref) => (
        <Badge
          className={cn("max-w-36 truncate", gitRefClassName(ref.type))}
          key={`${commit.hash}:${ref.type}:${ref.name}`}
          variant="outline"
        >
          {ref.name}
        </Badge>
      ))}
    </div>
  )
}

function FileHeader({
  file,
  selected,
}: {
  file?: GitStatusFile
  selected: Extract<GitSelection, { type: "file" }>
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 border-b px-3 py-3">
      <GitPullRequestIcon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{selected.path}</div>
        <div className="text-xs text-muted-foreground">
          {selected.staged ? "Staged diff" : "Workspace diff"}
        </div>
      </div>
      {file ? (
        <Badge className={gitStatusClassName(file.status)} variant="outline">
          {gitStatusLabel(file.status)}
        </Badge>
      ) : null}
    </div>
  )
}

function OverviewHeader({ status }: { status?: GitStatusResult }) {
  return (
    <div className="flex min-w-0 items-center gap-2 border-b px-3 py-3">
      <GitBranchIcon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="truncate font-medium">
          {status?.branch.current ?? "Repository"}
        </div>
        <div className="text-xs text-muted-foreground">Workspace overview</div>
      </div>
    </div>
  )
}

function RepositoryOverview({ status }: { status?: GitStatusResult }) {
  const staged = status?.files.filter((file) => file.staged).length ?? 0
  const changed = status?.files.filter((file) => file.unstaged).length ?? 0

  return (
    <div className="grid gap-3 p-3">
      <OverviewMetric label="Staged files" value={staged} />
      <OverviewMetric label="Workspace changes" value={changed} />
      <OverviewMetric label="Ahead" value={status?.branch.ahead ?? 0} />
      <OverviewMetric label="Behind" value={status?.branch.behind ?? 0} />
    </div>
  )
}

function OverviewMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="font-mono text-sm font-medium">{value}</span>
    </div>
  )
}

function DiffStack({ diffs }: { diffs: ReturnType<typeof parseGitDiff> }) {
  if (diffs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
        No diff available.
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex min-w-0 flex-col gap-3 p-3">
        {diffs.map((diff) => (
          <div
            className="min-w-0 overflow-hidden rounded-md border"
            key={diff.file}
          >
            <DevelopmentDiffView diff={diff} scroll={false} title={diff.file} />
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}

function DiffSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-3">
      <Skeleton className="h-8 w-3/4" />
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-36 w-full" />
    </div>
  )
}
