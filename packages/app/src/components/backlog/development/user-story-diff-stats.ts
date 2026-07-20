import * as React from "react"

import type { UserStory } from "@/components/backlog/data/backlog-data"
import {
  totalDiffStats,
  type UserStoryDiffStats,
} from "@/components/backlog/development/development-diff-stats-data"
import { parseGitDiff } from "@/components/backlog/development/development-workspace"
import type { Platform } from "@/context/platform"

const diffStatsRefreshDelayMs = 1_500

export type { UserStoryDiffStats } from "@/components/backlog/development/development-diff-stats-data"

type UserStoryDiffTarget =
  | {
      id: string
      mode: "working"
      root: string
    }
  | {
      from: string
      id: string
      mode: "historical"
      root: string
      to: string
    }

type UserStoryDiffResult = {
  id: string
  stats?: UserStoryDiffStats
}

type UserStoryDiffStatsSetter = React.Dispatch<
  React.SetStateAction<Map<string, UserStoryDiffStats>>
>

export function useUserStoryDiffStats(
  stories: UserStory[],
  workspace: Platform["workspace"],
  repositoryRoot?: string
) {
  const [stats, setStats] = React.useState(
    () => new Map<string, UserStoryDiffStats>()
  )
  const targets = React.useMemo(
    () => userStoryDiffTargets(stories, repositoryRoot),
    [repositoryRoot, stories]
  )

  React.useEffect(() => {
    return subscribeUserStoryDiffStats(targets, workspace, setStats)
  }, [targets, workspace])

  return stats
}

export function diffStatsFromPatch(patch: string): UserStoryDiffStats {
  return totalDiffStats(parseGitDiff(patch))
}

function subscribeUserStoryDiffStats(
  targets: UserStoryDiffTarget[],
  workspace: Platform["workspace"],
  setStats: UserStoryDiffStatsSetter
) {
  let cancelled = false
  const load = (selectedTargets: UserStoryDiffTarget[]) =>
    loadUserStoryDiffStats(
      selectedTargets,
      targets,
      workspace,
      setStats,
      () => cancelled
    )
  load(targets)
  const workingTargets = targets.filter((target) => target.mode === "working")
  const timer = setInterval(() => {
    if (document.visibilityState === "visible") load(workingTargets)
  }, diffStatsRefreshDelayMs)
  return () => {
    cancelled = true
    clearInterval(timer)
  }
}

function loadUserStoryDiffStats(
  selectedTargets: UserStoryDiffTarget[],
  retainedTargets: UserStoryDiffTarget[],
  workspace: Platform["workspace"],
  setStats: UserStoryDiffStatsSetter,
  cancelled: () => boolean
) {
  if (!workspace || !retainedTargets.length) {
    setStats((current) => pruneUserStoryDiffStats(current, retainedTargets))
    return
  }
  if (!selectedTargets.length) return
  void Promise.all(
    selectedTargets.map((target) => loadUserStoryDiffStat(target, workspace))
  ).then((results) => {
    if (cancelled()) return
    setStats((current) =>
      mergeUserStoryDiffStats(current, retainedTargets, results)
    )
  })
}

function userStoryDiffTargets(
  stories: UserStory[],
  repositoryRoot?: string
): UserStoryDiffTarget[] {
  return stories.flatMap<UserStoryDiffTarget>((story) => {
    if (
      (story.status === "in-progress" || story.status === "in-review") &&
      story.worktree
    ) {
      return [{ id: story.id, mode: "working", root: story.worktree }]
    }
    if (story.status !== "done" || !story.mergeCommit || !repositoryRoot) {
      return []
    }
    return [
      {
        from: story.baseCommit ?? `${story.mergeCommit}^`,
        id: story.id,
        mode: "historical",
        root: repositoryRoot,
        to: story.mergeCommit,
      },
    ]
  })
}

async function loadUserStoryDiffStat(
  target: UserStoryDiffTarget,
  workspace: NonNullable<Platform["workspace"]>
): Promise<UserStoryDiffResult> {
  try {
    const patch =
      target.mode === "working"
        ? await workspace.gitDiff({ root: target.root })
        : await workspace.gitDiffBetween(target)
    return { id: target.id, stats: diffStatsFromPatch(patch) }
  } catch {
    return { id: target.id }
  }
}

function mergeUserStoryDiffStats(
  current: Map<string, UserStoryDiffStats>,
  targets: UserStoryDiffTarget[],
  results: UserStoryDiffResult[]
) {
  const next = retainedUserStoryDiffStats(current, targets)
  for (const result of results) {
    if (result.stats) next.set(result.id, result.stats)
    else next.delete(result.id)
  }
  return sameUserStoryDiffStats(current, next) ? current : next
}

function pruneUserStoryDiffStats(
  current: Map<string, UserStoryDiffStats>,
  targets: UserStoryDiffTarget[]
) {
  const next = retainedUserStoryDiffStats(current, targets)
  return sameUserStoryDiffStats(current, next) ? current : next
}

function retainedUserStoryDiffStats(
  current: Map<string, UserStoryDiffStats>,
  targets: UserStoryDiffTarget[]
) {
  const storyIds = new Set(targets.map((target) => target.id))
  return new Map([...current].filter(([id]) => storyIds.has(id)))
}

function sameUserStoryDiffStats(
  current: Map<string, UserStoryDiffStats>,
  next: Map<string, UserStoryDiffStats>
) {
  if (current.size !== next.size) return false
  return [...current].every(([id, stats]) => {
    const nextStats = next.get(id)
    if (!nextStats) return false
    return (
      stats.additions === nextStats.additions &&
      stats.deletions === nextStats.deletions &&
      stats.files === nextStats.files
    )
  })
}
