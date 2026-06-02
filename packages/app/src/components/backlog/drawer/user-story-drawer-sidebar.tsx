import * as React from "react"
import type { AgentUsageSummary, AgentUsageTotals } from "@blame/agent-runtime"

import type {
  BacklogColumnId,
  UserStory,
} from "@/components/backlog/data/backlog-data"
import {
  ModelSelector,
  useModelSelection,
} from "@/components/model/model-selector"
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
    <aside className="h-full min-h-full border-l bg-muted/20 p-5">
      <div className="grid gap-5">
        <div className="flex items-start justify-between gap-4">
          <SidebarField label="Model assigned">
            <ModelSelector />
          </SidebarField>
          <ColumnStatusBadge status={status} />
        </div>
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
    <section className="grid gap-4 border-t pt-5">
      <TokenGroup title="Model configuration">
        <TokenStat label="Provider" value={userStory.agentProviderId} />
        <TokenStat label="Model" value={userStory.agentModelId} />
        <TokenStat
          label="Context limit"
          value={formatInteger(contextLimit)}
        />
      </TokenGroup>
      {usageContent(sessionUsage, contextLimit, userStory.agentUsage)}
      <TokenDiagnostics userStory={userStory} />
    </section>
  )
}

function usageContent(
  sessionUsage: SessionUsageState,
  contextLimit: number | undefined,
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

  return (
    <TokenUsageTotals
      agentUsage={agentUsage}
      totals={totals}
      contextLimit={contextLimit}
    />
  )
}

function TokenUsageTotals({
  agentUsage,
  contextLimit,
  totals,
}: {
  agentUsage: UserStory["agentUsage"]
  contextLimit: number | undefined
  totals: AgentUsageTotals
}) {
  const fallbackTotalTokens = usageTotalTokens(totals)
  const currentTotalTokens = positiveUsageValue(
    agentUsage?.currentTotalTokens,
    fallbackTotalTokens
  )
  const sessionTotalTokens = positiveUsageValue(
    agentUsage?.sessionTotalTokens,
    fallbackTotalTokens
  )

  return (
    <>
      <UsageOverview
        contextLimit={contextLimit}
        currentTotalTokens={currentTotalTokens}
        totalCost={totals.totalCost}
      />
      <TotalTokens
        currentTotalTokens={currentTotalTokens}
        sessionTotalTokens={sessionTotalTokens}
      />
      <InputOutputTokens totals={totals} />
      <CacheTokens totals={totals} />
    </>
  )
}

function UsageOverview({
  contextLimit,
  currentTotalTokens,
  totalCost,
}: {
  contextLimit: number | undefined
  currentTotalTokens: number
  totalCost: number | null | undefined
}) {
  return (
    <TokenGroup title="Usage overview">
      <TokenStat
        label="Usage"
        value={formatUsage(currentTotalTokens, contextLimit)}
      />
      <TokenStat label="Total cost" value={formatCurrency(totalCost)} />
    </TokenGroup>
  )
}

function TotalTokens({
  currentTotalTokens,
  sessionTotalTokens,
}: {
  currentTotalTokens: number
  sessionTotalTokens: number
}) {
  return (
    <TokenGroup title="Token totals">
      <TokenStat
        label="Current total"
        value={formatInteger(currentTotalTokens)}
      />
      <TokenStat
        label="Session total"
        value={formatInteger(sessionTotalTokens)}
      />
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
    </TokenGroup>
  )
}

function TokenDiagnostics({ userStory }: { userStory: UserStory }) {
  const usage = userStory.agentUsage
  if (!usage) return null
  const topTools = usage.topTools
    .map((tool) => `${tool.name}: ${formatInteger(tool.totalBytes)} bytes`)
    .join("\n")

  return <TokenDiagnosticGroup usage={usage} topTools={topTools} />
}

function TokenDiagnosticGroup({
  topTools,
  usage,
}: {
  topTools: string
  usage: NonNullable<UserStory["agentUsage"]>
}) {
  return (
    <TokenGroup title="Diagnostics">
      <TokenStat
        label="Max context"
        value={formatInteger(usage.maxContextTokens)}
      />
      <TokenStat
        label="Raw with cache"
        value={formatInteger(usage.rawTotalTokens)}
      />
      <TokenStat
        label="Compactions"
        value={formatInteger(usage.compactionCount)}
      />
      <TokenStat
        label="Truncated"
        value={formatInteger(usage.truncatedOutputs)}
      />
      <TokenStat label="File reads" value={fileReadValue(usage)} />
      <TokenStat
        label="Saved tokens"
        value={formatInteger(usage.tokensSavedEstimate)}
      />
      <TokenStat
        className="col-span-full"
        label="Largest tools"
        value={topTools || "-"}
      />
    </TokenGroup>
  )
}

function fileReadValue(usage: NonNullable<UserStory["agentUsage"]>) {
  return `${formatInteger(usage.unboundedFileReads)} / ${formatInteger(usage.largeFileReads)}`
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

function SidebarField({
  children,
  label,
}: {
  children: React.ReactNode
  label: string
}) {
  return (
    <div className="grid min-w-0 flex-1 gap-2">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      {children}
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

function usageTotalTokens(totals: AgentUsageTotals) {
  return totals.inputTokens + totals.outputTokens
}

function usageTotalsFromAgentUsage(usage: UserStory["agentUsage"]) {
  if (!usage) return undefined
  return {
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalCost: usage.totalCost,
  }
}

function positiveUsageValue(value: number | undefined, fallback: number) {
  return value && value > 0 ? value : fallback
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
