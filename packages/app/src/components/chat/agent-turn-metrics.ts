import * as React from "react"

import { totalDiffStats } from "@/components/backlog/development/development-diff-stats-data"
import {
  normalizeDiffs,
  parseGitDiff,
} from "@/components/backlog/development/development-workspace"
import { usePlatform, type Platform } from "@/context/platform"
import {
  agentTurnElapsedTime,
  type AgentTurnMetricRun,
  type AgentTurnMetrics,
} from "./agent-turn-metrics-data"

export {
  agentTurnMetricsTarget,
  formatAgentTurnDuration,
  latestLinkedAgentTurn,
  type AgentTurnMetrics,
} from "./agent-turn-metrics-data"

const refreshIntervalMs = 2_500

export function useAgentTurnMetrics({
  root,
  run,
  startedAt,
}: {
  root?: string | null
  run?: AgentTurnMetricRun
  startedAt?: string
}): AgentTurnMetrics | undefined {
  const platform = usePlatform()
  const [boundary, setBoundary] = React.useState<RunBoundary>()
  const [diffStats, setDiffStats] = React.useState<RunDiffStats>()
  const [currentTime, setCurrentTime] = React.useState(Date.now)

  useRunBoundary(platform, run, setBoundary)
  useRunDiffStats(platform, root, run, boundary, setDiffStats)
  useCurrentTime(run, setCurrentTime)

  if (!run || !startedAt) return undefined
  const stats = diffStats?.runId === run.id ? diffStats : undefined
  return {
    additions: stats?.additions ?? 0,
    deletions: stats?.deletions ?? 0,
    elapsedMs: agentTurnElapsedTime(run, startedAt, currentTime),
    running: run.status === "running",
  }
}

type RunBoundary = { ref: string; runId: string }
type RunDiffStats = {
  additions: number
  deletions: number
  files: number
  runId: string
}
type RunDiffRefreshInput = {
  diffEndRef?: string | null
  from: string
  runId: string
  running: boolean
}

function useRunBoundary(
  platform: Platform,
  run: AgentTurnMetricRun | undefined,
  setBoundary: React.Dispatch<React.SetStateAction<RunBoundary | undefined>>
) {
  const checkpointRunCount = run?.checkpointRunCount
  const runId = run?.id
  const sessionId = run?.clineSessionId
  React.useEffect(() => {
    if (!runId || !checkpointRunCount || !sessionId || !platform.agent) return
    let active = true
    platform.agent.sessions
      .compareCheckpoint({ checkpointRunCount, sessionId })
      .then(({ checkpoint }) => {
        if (active) setBoundary({ ref: checkpoint.ref, runId })
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [checkpointRunCount, platform.agent, runId, sessionId, setBoundary])
}

function useRunDiffStats(
  platform: Platform,
  root: string | null | undefined,
  run: AgentTurnMetricRun | undefined,
  boundary: RunBoundary | undefined,
  setDiffStats: React.Dispatch<React.SetStateAction<RunDiffStats | undefined>>
) {
  const diffEndRef = run?.diffEndRef
  const runId = run?.id
  const runStatus = run?.status
  React.useEffect(() => {
    if (!root || !runId || boundary?.runId !== runId || !platform.workspace)
      return
    return refreshRunDiffStats(
      platform,
      root,
      {
        diffEndRef,
        from: boundary.ref,
        runId,
        running: runStatus === "running",
      },
      setDiffStats
    )
  }, [boundary, diffEndRef, platform, root, runId, runStatus, setDiffStats])
}

function refreshRunDiffStats(
  platform: Platform,
  root: string,
  input: RunDiffRefreshInput,
  setDiffStats: React.Dispatch<React.SetStateAction<RunDiffStats | undefined>>
) {
  let active = true
  let refreshing = false
  const refresh = async () => {
    if (refreshing) return
    refreshing = true
    try {
      const stats = await loadRunDiffStats(platform, root, input)
      if (active) setDiffStats({ ...stats, runId: input.runId })
    } catch {
      return
    } finally {
      refreshing = false
    }
  }
  void refresh()
  const interval = input.running
    ? window.setInterval(refresh, refreshIntervalMs)
    : undefined
  return () => {
    active = false
    if (interval) window.clearInterval(interval)
  }
}

function useCurrentTime(
  run: AgentTurnMetricRun | undefined,
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>
) {
  React.useEffect(() => {
    if (run?.status !== "running") return
    setCurrentTime(Date.now())
    const interval = window.setInterval(() => setCurrentTime(Date.now()), 1_000)
    return () => window.clearInterval(interval)
  }, [run?.id, run?.status, setCurrentTime])
}

async function loadRunDiffStats(
  platform: Platform,
  root: string,
  input: RunDiffRefreshInput
) {
  const workspace = platform.workspace!
  const to =
    input.diffEndRef ?? (await workspace.gitSnapshot({ id: input.runId, root }))
  if (workspace.gitDiffStats)
    return workspace.gitDiffStats({ from: input.from, root, to })
  const patch = await workspace.gitDiffBetween({
    from: input.from,
    root,
    to,
  })
  return totalDiffStats(normalizeDiffs(parseGitDiff(patch)))
}
