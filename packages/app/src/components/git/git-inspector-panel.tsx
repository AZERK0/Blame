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
import { DiffStats } from "@/components/backlog/development/development-diff-stats"
import { DevelopmentDiffView } from "@/components/backlog/development/development-diff-view"
import { DevelopmentScrollArea } from "@/components/backlog/development/development-scroll-area"
import { GitHubRepositoryCard } from "@/components/git/git-github-repository-card"
import { GitBranchIcon, GitCommitIcon, GitPullRequestIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
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
    <aside className="flex min-h-[34rem] min-w-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-xl ring-1 shadow-black/10 ring-foreground/10 xl:min-h-0">
      <InspectorHeader
        commits={commits}
        diffLoading={diffLoading}
        diffs={diffs}
        selected={selected}
        status={status}
      />
      <div className="min-h-0 flex-1 bg-muted/10 dark:bg-muted/20">
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
  diffLoading,
  diffs,
  selected,
  status,
}: {
  commits: GitLogCommit[]
  diffLoading: boolean
  diffs: ReturnType<typeof parseGitDiff>
  selected?: GitSelection
  status?: GitStatusResult
}) {
  if (selected?.type === "commit") {
    const commit = commits.find((item) => item.hash === selected.hash)
    return (
      <CommitHeader commit={commit} diffLoading={diffLoading} diffs={diffs} />
    )
  }
  if (selected?.type === "file") {
    const file = status?.files.find((item) => item.path === selected.path)
    return (
      <FileHeader
        diffLoading={diffLoading}
        diffs={diffs}
        file={file}
        selected={selected}
      />
    )
  }
  return <OverviewHeader status={status} />
}

function CommitHeader({
  commit,
  diffLoading,
  diffs,
}: {
  commit?: GitLogCommit
  diffLoading: boolean
  diffs: ReturnType<typeof parseGitDiff>
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 border-b bg-muted/20 px-3 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <GitCommitIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">
          {commit?.message ?? "Commit"}
        </span>
      </div>
      {commit ? <CommitMeta commit={commit} /> : null}
      <DiffSummary diffLoading={diffLoading} diffs={diffs} />
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
  const visible = visibleInspectorRefs(commit)
  const hidden = commit.refs.length - visible.length

  return (
    <div className="flex max-w-full min-w-0 flex-wrap gap-1 overflow-hidden">
      {visible.map((ref) => (
        <Badge
          className={cn("max-w-28 min-w-0 truncate", gitRefClassName(ref.type))}
          key={`${commit.hash}:${ref.type}:${ref.name}`}
          variant="outline"
        >
          {ref.name}
        </Badge>
      ))}
      {hidden > 0 ? (
        <Badge
          className="border-muted-foreground/20 bg-muted/60 text-muted-foreground"
          title={commit.refs.map((ref) => ref.name).join(", ")}
          variant="outline"
        >
          +{hidden}
        </Badge>
      ) : null}
    </div>
  )
}

function visibleInspectorRefs(commit: GitLogCommit) {
  const primary = commit.refs.filter(primaryRef)
  return (primary.length ? primary : commit.refs).slice(0, 3)
}

function primaryRef(ref: GitLogCommit["refs"][number]) {
  if (ref.type === "tag") return true
  return [
    "HEAD",
    "main",
    "master",
    "origin/HEAD",
    "origin/main",
    "origin/master",
  ].includes(ref.name)
}

function FileHeader({
  diffLoading,
  diffs,
  file,
  selected,
}: {
  diffLoading: boolean
  diffs: ReturnType<typeof parseGitDiff>
  file?: GitStatusFile
  selected: Extract<GitSelection, { type: "file" }>
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 border-b bg-muted/20 px-3 py-3">
      <div className="flex min-w-0 items-center gap-2">
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
      <DiffSummary diffLoading={diffLoading} diffs={diffs} />
    </div>
  )
}

function OverviewHeader({ status }: { status?: GitStatusResult }) {
  return (
    <div className="flex min-w-0 items-center gap-2 border-b bg-muted/20 px-3 py-3">
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
      <GitHubRepositoryCard remote={status?.remote} />
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
    <div className="h-full min-h-0 overflow-y-auto p-3">
      <div className="flex max-w-full min-w-0 flex-col gap-3">
        {diffs.map((diff) => (
          <DiffCard diff={diff} key={diff.file} />
        ))}
      </div>
    </div>
  )
}

function DiffCard({ diff }: { diff: ReturnType<typeof parseGitDiff>[number] }) {
  return (
    <div className="max-w-full min-w-0 overflow-hidden rounded-xl border bg-card">
      <div className="flex min-w-0 items-center gap-2 border-b bg-muted/20 px-4 py-2">
        <span className="truncate font-medium">{diff.file}</span>
        <DiffStats diff={diff} />
      </div>
      <DevelopmentScrollArea className="max-h-[32rem] w-full max-w-full min-w-0">
        <div className="w-max min-w-full">
          <DevelopmentDiffView diff={diff} scroll={false} />
        </div>
      </DevelopmentScrollArea>
    </div>
  )
}

function DiffSummary({
  diffLoading,
  diffs,
}: {
  diffLoading: boolean
  diffs: ReturnType<typeof parseGitDiff>
}) {
  if (diffLoading) {
    return <div className="text-xs text-muted-foreground">Loading diff</div>
  }
  const summary = diffSummary(diffs)
  if (!summary) return null
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>{summary.files}</span>
      <Badge
        className="h-5 border-emerald-500/30 bg-emerald-500/10 px-1.5 text-emerald-600 dark:text-emerald-400"
        variant="outline"
      >
        +{summary.additions}
      </Badge>
      <Badge
        className="h-5 border-destructive/30 bg-destructive/10 px-1.5 text-destructive"
        variant="outline"
      >
        -{summary.deletions}
      </Badge>
    </div>
  )
}

function diffSummary(diffs: ReturnType<typeof parseGitDiff>) {
  if (diffs.length === 0) return undefined
  const additions = diffs.reduce((sum, diff) => sum + (diff.additions ?? 0), 0)
  const deletions = diffs.reduce((sum, diff) => sum + (diff.deletions ?? 0), 0)
  const files =
    diffs.length === 1 ? "1 file changed" : `${diffs.length} files changed`
  return { additions, deletions, files }
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
