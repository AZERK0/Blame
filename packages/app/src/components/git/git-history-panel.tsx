import type { GitLogCommit } from "@/context/platform"
import type { GitSelection } from "@/components/git/git-types"
import { gitCommitSelection, gitSelectionKey } from "@/components/git/git-types"
import {
  gitDateLabel,
  gitRefClassName,
  gitRelativeDate,
  shortGitHash,
} from "@/components/git/git-format"
import { GitCommitIcon, SearchIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export function GitHistoryPanel({
  commits,
  loading,
  onCommitSelect,
  onQueryChange,
  query,
  selected,
}: {
  commits: GitLogCommit[]
  loading: boolean
  onCommitSelect(selection: GitSelection): void
  onQueryChange(value: string): void
  query: string
  selected?: GitSelection
}) {
  const filtered = filterCommits(commits, query)

  return (
    <main className="flex min-h-[34rem] min-w-0 flex-col border-b bg-background xl:min-h-0 xl:border-r xl:border-b-0">
      <HistoryToolbar
        count={filtered.length}
        query={query}
        onQueryChange={onQueryChange}
      />
      <ScrollArea className="min-h-0 flex-1">
        {loading && commits.length === 0 ? <HistorySkeleton /> : null}
        {!loading && filtered.length === 0 ? (
          <HistoryEmpty query={query} />
        ) : null}
        {filtered.length > 0 ? (
          <div className="min-w-0 p-2">
            {filtered.map((commit) => (
              <CommitRow
                commit={commit}
                key={commit.hash}
                selected={selected}
                onSelect={onCommitSelect}
              />
            ))}
          </div>
        ) : null}
      </ScrollArea>
    </main>
  )
}

function HistoryToolbar({
  count,
  onQueryChange,
  query,
}: {
  count: number
  onQueryChange(value: string): void
  query: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 border-b px-3 py-2">
      <div className="relative min-w-0 flex-1">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder="Search message, author, hash, branch"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>
      <Badge className="shrink-0" variant="outline">
        {count} commits
      </Badge>
    </div>
  )
}

function CommitRow({
  commit,
  onSelect,
  selected,
}: {
  commit: GitLogCommit
  onSelect(selection: GitSelection): void
  selected?: GitSelection
}) {
  const selection = gitCommitSelection(commit.hash)
  const active = gitSelectionKey(selection) === gitSelectionKey(selected)

  return (
    <button
      className={cn(
        "relative grid w-full grid-cols-[1.25rem_minmax(0,1fr)_5.75rem] items-stretch gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
        active &&
          "bg-muted before:absolute before:top-1 before:bottom-1 before:left-0 before:w-0.5 before:rounded-full before:bg-blue-500"
      )}
      type="button"
      onClick={() => onSelect(selection)}
    >
      <CommitGraphDot active={active} />
      <CommitBody commit={commit} />
      <span
        className="truncate text-right text-xs text-muted-foreground"
        title={gitDateLabel(commit.date)}
      >
        {gitRelativeDate(commit.date)}
      </span>
    </button>
  )
}

function CommitGraphDot({ active }: { active: boolean }) {
  return (
    <span className="relative flex min-h-10 items-center justify-center">
      <span className="absolute -top-2 -bottom-2 left-1/2 w-px -translate-x-1/2 bg-border" />
      <span
        className={cn(
          "relative z-1 size-2.5 rounded-full border bg-background",
          active ? "border-blue-500 bg-blue-500" : "border-emerald-500"
        )}
      />
    </span>
  )
}

function CommitBody({ commit }: { commit: GitLogCommit }) {
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span className="min-w-0 truncate leading-5 font-medium">
        {commit.message}
      </span>
      <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <span className="shrink-0 font-mono">{shortGitHash(commit.hash)}</span>
        <span className="min-w-0 truncate">{commit.authorName}</span>
        <CommitRefs commit={commit} />
      </span>
    </span>
  )
}

function CommitRefs({ commit }: { commit: GitLogCommit }) {
  const refs = visibleCommitRefs(commit)
  if (refs.visible.length === 0 && refs.hidden === 0) return null

  return (
    <span className="flex min-w-0 shrink-0 items-center gap-1">
      {refs.visible.map((ref) => (
        <Badge
          className={cn("max-w-24 truncate px-1.5", gitRefClassName(ref.type))}
          key={`${commit.hash}:${ref.type}:${ref.name}`}
          variant="outline"
        >
          {ref.name}
        </Badge>
      ))}
      {refs.hidden > 0 ? (
        <Badge
          className="border-muted-foreground/20 bg-muted/60 px-1.5 text-muted-foreground"
          title={commit.refs.map((ref) => ref.name).join(", ")}
          variant="outline"
        >
          +{refs.hidden}
        </Badge>
      ) : null}
    </span>
  )
}

function visibleCommitRefs(commit: GitLogCommit) {
  const primary = commit.refs.filter(primaryRef)
  const visible = primary.slice(0, 2)
  return {
    hidden: Math.max(0, commit.refs.length - visible.length),
    visible,
  }
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

function HistoryEmpty({ query }: { query: string }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
      <GitCommitIcon className="size-8" />
      <div>
        {query.trim() ? "No commits match this search." : "No commits yet."}
      </div>
    </div>
  )
}

function HistorySkeleton() {
  return (
    <div className="flex flex-col gap-2 p-3">
      {Array.from({ length: 12 }).map((_, index) => (
        <Skeleton className="h-8 w-full" key={index} />
      ))}
    </div>
  )
}

function filterCommits(commits: GitLogCommit[], query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return commits
  return commits.filter((commit) => commitMatchesQuery(commit, normalized))
}

function commitMatchesQuery(commit: GitLogCommit, query: string) {
  return [
    commit.hash,
    commit.message,
    commit.authorName,
    commit.authorEmail,
    ...commit.refs.map((ref) => ref.name),
  ]
    .join("\n")
    .toLowerCase()
    .includes(query)
}
