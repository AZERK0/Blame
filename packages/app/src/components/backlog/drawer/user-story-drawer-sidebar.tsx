import * as React from "react"
import type { AgentUsageSummary, AgentUsageTotals } from "@blame/agent-runtime"

import type { UserStory } from "@/components/backlog/data/backlog-data"
import { DiffStats } from "@/components/backlog/development/development-diff-stats"
import type { UserStoryDiffStats } from "@/components/backlog/development/user-story-diff-stats"
import { useModelSelection } from "@/components/model/model-selector"
import { Separator } from "@/components/ui/separator"
import { usePlatform } from "@/context/platform"

export function DrawerSidebar({
  diffStats,
  userStory,
}: {
  diffStats?: UserStoryDiffStats
  userStory?: UserStory
}) {
  return (
    <aside className="p-5 pr-14">
      <div className="grid gap-6">
        <section className="grid min-w-0 gap-5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">Dev Agent</h2>
            <p className="text-xs text-muted-foreground">Execution settings</p>
          </div>
        </section>
        {diffStats && <CodeChanges diffStats={diffStats} />}
        <TokenUsage userStory={userStory} />
      </div>
    </aside>
  )
}

function CodeChanges({ diffStats }: { diffStats: UserStoryDiffStats }) {
  return (
    <TokenGroup title="Code changes">
      <TokenStat
        className="col-span-2"
        label="Lines added / removed"
        value={<DiffStats className="ml-0" diff={diffStats} />}
      />
    </TokenGroup>
  )
}

function TokenUsage({ userStory }: { userStory?: UserStory }) {
  const sessionUsage = useSessionUsage(userStory?.clineSessionId)
  const selection = useModelSelection()
  const contextLimit = modelContextLimit(userStory, selection.allProviders)
  if (!userStory?.clineSessionId && !userStory?.agentUsage) return null

  return (
    <section className="grid gap-4">
      <TokenGroup title="Model configuration">
        <TokenStat label="Provider" value={userStory.agentProviderId} />
        <TokenStat label="Model" value={userStory.agentModelId} />
        <TokenStat label="Context limit" value={formatInteger(contextLimit)} />
      </TokenGroup>
      {usageContent(
        sessionUsage,
        userStory.agentUsage,
        selection.contextCompressionMode === "headroom"
      )}
    </section>
  )
}

function usageContent(
  sessionUsage: SessionUsageState,
  agentUsage: UserStory["agentUsage"],
  headroomSelected: boolean
) {
  const storyTotals = usageTotalsFromAgentUsage(agentUsage)

  if (sessionUsage.loading && !storyTotals) {
    return (
      <TokenGroup title="Loading">
        <TokenStat label="Usage" value="Loading" />
      </TokenGroup>
    )
  }

  const totals = storyTotals ?? sessionUsage.totals
  if (!totals) {
    return (
      <TokenGroup title="Usage overview">
        <TokenStat label="Usage" value="-" />
      </TokenGroup>
    )
  }

  return (
    <TokenUsageTotals headroomSelected={headroomSelected} totals={totals} />
  )
}

function TokenUsageTotals({
  headroomSelected,
  totals,
}: {
  headroomSelected: boolean
  totals: AgentUsageTotals
}) {
  return (
    <div className="grid gap-4">
      <CostTokens totals={totals} />
      <InputOutputTokens totals={totals} />
      <CacheTokens totals={totals} />
      {headroomSelected || hasHeadroomSavings(totals) ? (
        <HeadroomTokens totals={totals} />
      ) : null}
    </div>
  )
}

function CostTokens({ totals }: { totals: AgentUsageTotals }) {
  return (
    <TokenGroup title="Cost">
      <TokenStat label="Cost" value={formatCurrency(totals.cost)} />
      <TokenStat label="Total cost" value={formatCurrency(totals.totalCost)} />
    </TokenGroup>
  )
}

function InputOutputTokens({ totals }: { totals: AgentUsageTotals }) {
  return (
    <TokenGroup title="Generation tokens">
      <TokenStat
        label="Input tokens"
        value={formatInteger(totals.inputTokens)}
      />
      <TokenStat
        label="Output tokens"
        value={formatInteger(totals.outputTokens)}
      />
      <TokenStat
        label="Total input tokens"
        value={formatInteger(totals.totalInputTokens)}
      />
      <TokenStat
        label="Total output tokens"
        value={formatInteger(totals.totalOutputTokens)}
      />
    </TokenGroup>
  )
}

function CacheTokens({ totals }: { totals: AgentUsageTotals }) {
  return (
    <TokenGroup title="Cache tokens">
      <TokenStat
        label="Cache read"
        value={formatInteger(totals.cacheReadTokens)}
      />
      <TokenStat
        label="Cache write"
        value={formatInteger(totals.cacheWriteTokens)}
      />
      <TokenStat
        label="Total cache read"
        value={formatInteger(totals.totalCacheReadTokens)}
      />
      <TokenStat
        label="Total cache write"
        value={formatInteger(totals.totalCacheWriteTokens)}
      />
    </TokenGroup>
  )
}

function HeadroomTokens({ totals }: { totals: AgentUsageTotals }) {
  return (
    <TokenGroup title="Headroom savings">
      <TokenStat
        label="Saved tokens"
        value={formatInteger(totals.headroomTokensSaved)}
      />
      <TokenStat
        label="Reduction"
        value={formatPercent(headroomReduction(totals))}
      />
      <TokenStat
        label="Before / after"
        value={formatTokenPair(
          totals.headroomTokensBefore,
          totals.headroomTokensAfter
        )}
      />
      <TokenStat
        label="Compressions"
        value={formatInteger(totals.headroomCompressionCount)}
      />
    </TokenGroup>
  )
}

function TokenGroup({
  children,
  title,
}: {
  children: React.ReactNode
  title: string
}) {
  return (
    <section className="grid gap-3">
      <Separator />
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </section>
  )
}

function TokenStat({
  className,
  label,
  value,
}: {
  className?: string
  label: string
  value?: React.ReactNode
}) {
  return (
    <div className={className ? `grid gap-1 ${className}` : "grid gap-1"}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium break-words whitespace-pre-line text-foreground">
        {value || "-"}
      </p>
    </div>
  )
}

type SessionUsageState = {
  loading?: boolean
  sessionId?: string
  totals?: AgentUsageTotals
}

function useSessionUsage(sessionId: string | null | undefined) {
  const platform = usePlatform()
  const [state, setState] = React.useState<SessionUsageState>({})

  React.useEffect(() => {
    const agent = platform.agent
    if (!agent || !sessionId) return

    let active = true
    void agent.sessions
      .usage(sessionId)
      .then((summary) => {
        if (active) setState({ sessionId, totals: usageTotals(summary) })
      })
      .catch(() => {
        if (active) setState({ sessionId })
      })
    return () => {
      active = false
    }
  }, [platform.agent, sessionId])

  if (!platform.agent || !sessionId) return {}
  return { ...state, loading: state.sessionId !== sessionId }
}

function usageTotals(summary: AgentUsageSummary | undefined) {
  return summary?.aggregateUsage ?? summary?.usage
}

function modelContextLimit(
  userStory: UserStory | undefined,
  providers: ReturnType<typeof useModelSelection>["allProviders"]
) {
  const provider = providers.find(
    (item) => item.id === userStory?.agentProviderId
  )
  const model = provider?.models[userStory?.agentModelId ?? ""]
  return model?.contextWindow ?? provider?.models.custom?.contextWindow
}

function usageTotalsFromAgentUsage(usage: UserStory["agentUsage"]) {
  if (!usage) return undefined
  return {
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    cost: usage.cost,
    headroomCompressionCount: usage.headroomCompressionCount,
    headroomCompressionRatio: usage.headroomCompressionRatio,
    headroomLastTokensSaved: usage.headroomLastTokensSaved,
    headroomTokensAfter: usage.headroomTokensAfter,
    headroomTokensBefore: usage.headroomTokensBefore,
    headroomTokensSaved: usage.headroomTokensSaved,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalCacheReadTokens: usage.totalCacheReadTokens,
    totalCacheWriteTokens: usage.totalCacheWriteTokens,
    totalCost: usage.totalCost,
    totalInputTokens: usage.totalInputTokens,
    totalOutputTokens: usage.totalOutputTokens,
  }
}

function hasHeadroomSavings(totals: AgentUsageTotals) {
  return (
    totals.headroomCompressionCount !== undefined ||
    totals.headroomTokensSaved !== undefined
  )
}

function headroomReduction(totals: AgentUsageTotals) {
  if (!totals.headroomTokensBefore) return undefined
  return totals.headroomTokensSaved
    ? totals.headroomTokensSaved / totals.headroomTokensBefore
    : 0
}

function formatTokenPair(
  before: number | null | undefined,
  after: number | null | undefined
) {
  if (before === undefined || before === null) return "-"
  if (after === undefined || after === null) return "-"
  return `${formatInteger(before)} / ${formatInteger(after)}`
}

function formatInteger(value: number | null | undefined) {
  if (value === undefined || value === null) return "-"
  return new Intl.NumberFormat("en-US").format(value)
}

function formatPercent(value: number | null | undefined) {
  if (value === undefined || value === null) return "-"
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    style: "percent",
  }).format(value)
}

function formatCurrency(value: number | null | undefined) {
  if (value === undefined || value === null) return "-"
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value)
}
