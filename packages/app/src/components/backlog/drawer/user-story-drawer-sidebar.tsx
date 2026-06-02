import * as React from "react"
import type { AgentUsageSummary, AgentUsageTotals } from "@blame/agent-runtime"

import type {
  BacklogColumnId,
  UserStory,
} from "@/components/backlog/data/backlog-data"
import { ModelSelector, useModelSelection } from "@/components/model/model-selector"
import { ColumnStatusBadge } from "@/components/backlog/shared/backlog-status-badge"
import { usePlatform } from "@/context/platform"

export function DrawerSidebar({
  status,
  userStory,
}: {
  status: BacklogColumnId
  userStory?: UserStory
}) {
  return (
    <aside className="border-l bg-muted/20 p-5">
      <div className="grid gap-5">
        <SidebarField label="Model assigned">
          <ModelSelector />
        </SidebarField>
        <ColumnStatusBadge status={status} />
        <TokenUsage userStory={userStory} />
      </div>
    </aside>
  )
}

function TokenUsage({ userStory }: { userStory?: UserStory }) {
  const sessionUsage = useSessionUsage(userStory?.clineSessionId)
  const selection = useModelSelection()
  const contextLimit = modelContextLimit(userStory, selection.allProviders)
  if (!userStory?.clineSessionId) return null

  return (
    <section className="grid gap-4 border-t pt-5">
      <p className="text-xs font-semibold text-muted-foreground">Token usage</p>
      <div className="grid gap-4">
        <TokenStat label="Provider" value={userStory.agentProviderId} />
        <TokenStat label="Model" value={userStory.agentModelId} />
        <TokenStat label="Context limit" value={formatInteger(contextLimit)} />
        {usageContent(sessionUsage, contextLimit)}
      </div>
    </section>
  )
}

function usageContent(
  sessionUsage: SessionUsageState,
  contextLimit: number | undefined
) {
  if (sessionUsage.loading) return <TokenStat label="Usage" value="Loading" />
  if (!sessionUsage.totals) return <TokenStat label="Usage" value="-" />
  return (
    <TokenUsageTotals
      totals={sessionUsage.totals}
      contextLimit={contextLimit}
    />
  )
}

function TokenUsageTotals({
  contextLimit,
  totals,
}: {
  contextLimit: number | undefined
  totals: AgentUsageTotals
}) {
  const totalTokens = usageTotalTokens(totals)
  return (
    <>
      <TokenStat label="Usage" value={formatUsage(totalTokens, contextLimit)} />
      <TokenStat label="Total tokens" value={formatInteger(totalTokens)} />
      <TokenStat label="Input tokens" value={formatInteger(totals.inputTokens)} />
      <TokenStat label="Output tokens" value={formatInteger(totals.outputTokens)} />
      <TokenStat
        label="Cache tokens (read/write)"
        value={`${formatInteger(totals.cacheReadTokens)} / ${formatInteger(totals.cacheWriteTokens)}`}
      />
      <TokenStat label="Total cost" value={formatCurrency(totals.totalCost)} />
    </>
  )
}

function TokenStat({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value || "-"}</p>
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
  const provider = providers.find((item) => item.id === userStory?.agentProviderId)
  const model = provider?.models[userStory?.agentModelId ?? ""]
  return model?.contextWindow ?? provider?.models.custom?.contextWindow
}

function usageTotalTokens(totals: AgentUsageTotals) {
  return (
    totals.inputTokens +
    totals.outputTokens +
    totals.cacheReadTokens +
    totals.cacheWriteTokens
  )
}

function formatUsage(totalTokens: number, contextLimit: number | undefined) {
  if (!contextLimit) return "-"
  return `${Math.round((totalTokens / contextLimit) * 100)}%`
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

function SidebarField({
  children,
  label,
}: {
  children: React.ReactNode
  label: string
}) {
  return (
    <div className="grid gap-2">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      {children}
    </div>
  )
}
