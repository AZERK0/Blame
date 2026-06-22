import * as React from "react"
import type { AgentUsageSummary, AgentUsageTotals } from "@blame/agent-runtime"

import type { UserStory } from "@/components/backlog/data/backlog-data"
import { useModelSelection } from "@/components/model/model-selector"
import { usePlatform } from "@/context/platform"

export function DrawerSidebar({
  userStory,
}: {
  userStory?: UserStory
}) {
  return (
    <aside className="p-5 pr-14">
      <div className="grid gap-6">
        <section className="grid min-w-0 gap-5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">
              Dev Agent
            </h2>
            <p className="text-xs text-muted-foreground">
              Execution settings
            </p>
          </div>
        </section>
        <TokenUsage userStory={userStory} />
      </div>
    </aside>
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
      {usageContent(sessionUsage, userStory.agentUsage)}
    </section>
  )
}

function usageContent(
  sessionUsage: SessionUsageState,
  agentUsage: UserStory["agentUsage"]
) {
  if (sessionUsage.loading) {
    return (
      <TokenGroup title="Loading">
        <TokenStat label="Usage" value="Loading" />
      </TokenGroup>
    )
  }

  const totals = sessionUsage.totals ?? usageTotalsFromAgentUsage(agentUsage)
  if (!totals) {
    return (
      <TokenGroup title="Usage overview">
        <TokenStat label="Usage" value="-" />
      </TokenGroup>
    )
  }

  return <TokenUsageTotals totals={totals} />
}

function TokenUsageTotals({ totals }: { totals: AgentUsageTotals }) {
  return (
    <>
      <CostTokens totals={totals} />
      <InputOutputTokens totals={totals} />
      <CacheTokens totals={totals} />
    </>
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

function TokenGroup({
  children,
  title,
}: {
  children: React.ReactNode
  title: string
}) {
  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border bg-background/60 p-3">
      <p className="col-span-full text-xs font-semibold text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
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
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalCacheReadTokens: usage.totalCacheReadTokens,
    totalCacheWriteTokens: usage.totalCacheWriteTokens,
    totalCost: usage.totalCost,
    totalInputTokens: usage.totalInputTokens,
    totalOutputTokens: usage.totalOutputTokens,
  }
}

function formatInteger(value: number | null | undefined) {
  if (value === undefined || value === null) return "-"
  return new Intl.NumberFormat("en-US").format(value)
}

function formatCurrency(value: number | null | undefined) {
  if (value === undefined || value === null) return "-"
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value)
}
