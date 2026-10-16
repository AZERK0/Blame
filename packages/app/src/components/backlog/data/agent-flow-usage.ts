import type { AgentEvent } from "@blame/agent-runtime"
import type {
  UserStoryAgentActivity,
  UserStoryAgentUsage,
} from "@/components/backlog/data/backlog-data"
import {
  eventPayload,
  numberValue,
  parseDetailRecord,
  recordValue,
} from "./agent-flow-values.ts"
import type { AgentFlowState } from "./agent-flow.ts"

export function eventUsage(
  story: AgentFlowState,
  event: AgentEvent
): UserStoryAgentUsage | undefined {
  const current = usageWithDefaults(story.agentUsage)
  if (event.type === "usage" || event.type === "done") {
    const next = usageFromUsageEvent(current, event)
    return usageChanged(current, next) ? next : undefined
  }
}

function usageFromUsageEvent(
  current: UserStoryAgentUsage,
  event: AgentEvent
): UserStoryAgentUsage {
  const payload = eventPayload(event)
  const payloadUsage = recordValue(payload.usage)
  const usage = Object.keys(payloadUsage).length ? payloadUsage : payload
  const doneAggregate = event.type === "done" && !usageHasTotals(usage)
  const next = {
    ...current,
    ...usageTurnFields(current, usage, doneAggregate),
    ...usageTotalFields(current, usage, doneAggregate),
  }
  return {
    ...next,
    inputTokens: next.inputTokens ?? 0,
    outputTokens: next.outputTokens ?? 0,
    totalInputTokens: next.totalInputTokens ?? 0,
    totalOutputTokens: next.totalOutputTokens ?? 0,
  }
}

function usageTurnFields(
  current: UserStoryAgentUsage,
  usage: Record<string, unknown>,
  doneAggregate: boolean
) {
  return {
    cacheReadTokens: usageTurnValue(
      current.cacheReadTokens,
      usage.cacheReadTokens,
      doneAggregate
    ),
    cacheWriteTokens: usageTurnValue(
      current.cacheWriteTokens,
      usage.cacheWriteTokens,
      doneAggregate
    ),
    cost: usageTurnValue(current.cost, usage.cost, doneAggregate),
    inputTokens: usageTurnValue(
      current.inputTokens,
      usage.inputTokens,
      doneAggregate
    ),
    outputTokens: usageTurnValue(
      current.outputTokens,
      usage.outputTokens,
      doneAggregate
    ),
  }
}

function usageTotalFields(
  current: UserStoryAgentUsage,
  usage: Record<string, unknown>,
  doneAggregate: boolean
) {
  return {
    totalCacheReadTokens: usageTotalValue(
      current.totalCacheReadTokens,
      usage.totalCacheReadTokens,
      usage.cacheReadTokens,
      doneAggregate
    ),
    totalCacheWriteTokens: usageTotalValue(
      current.totalCacheWriteTokens,
      usage.totalCacheWriteTokens,
      usage.cacheWriteTokens,
      doneAggregate
    ),
    totalCost: numberValue(usage.totalCost) ?? current.totalCost,
    totalInputTokens: usageTotalValue(
      current.totalInputTokens,
      usage.totalInputTokens,
      usage.inputTokens,
      doneAggregate
    ),
    totalOutputTokens: usageTotalValue(
      current.totalOutputTokens,
      usage.totalOutputTokens,
      usage.outputTokens,
      doneAggregate
    ),
  }
}

function usageTurnValue(
  current: number | undefined,
  next: unknown,
  doneAggregate: boolean
) {
  if (doneAggregate) return current
  return numberValue(next) ?? current
}

function usageTotalValue(
  current: number | undefined,
  next: unknown,
  aggregate: unknown,
  doneAggregate: boolean
) {
  return numberValue(next) ?? (doneAggregate ? numberValue(aggregate) : current)
}

function usageHasTotals(usage: Record<string, unknown>) {
  return (
    usage.totalInputTokens !== undefined ||
    usage.totalOutputTokens !== undefined ||
    usage.totalCacheReadTokens !== undefined ||
    usage.totalCacheWriteTokens !== undefined
  )
}

function usageChanged(current: UserStoryAgentUsage, next: UserStoryAgentUsage) {
  return (
    current.cacheReadTokens !== next.cacheReadTokens ||
    current.cacheWriteTokens !== next.cacheWriteTokens ||
    current.cost !== next.cost ||
    current.inputTokens !== next.inputTokens ||
    current.outputTokens !== next.outputTokens ||
    current.totalCacheReadTokens !== next.totalCacheReadTokens ||
    current.totalCacheWriteTokens !== next.totalCacheWriteTokens ||
    current.totalCost !== next.totalCost ||
    current.totalInputTokens !== next.totalInputTokens ||
    current.totalOutputTokens !== next.totalOutputTokens
  )
}

function emptyUsage(): UserStoryAgentUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  }
}

function usageWithDefaults(
  usage: UserStoryAgentUsage | null | undefined
): UserStoryAgentUsage {
  return { ...emptyUsage(), ...usage }
}

export function fileMentions(activities: UserStoryAgentActivity[]) {
  const values = new Set<string>()
  activities
    .filter((activity) => activity.kind === "tool")
    .forEach((activity) => collectActivityPaths(activity, values))
  return Array.from(values).slice(0, 12)
}

export function toolNames(activities: UserStoryAgentActivity[]) {
  return Array.from(
    new Set(
      activities
        .filter((activity) => activity.kind === "tool")
        .map((activity) => activity.title)
    )
  ).slice(0, 8)
}

function collectActivityPaths(
  activity: UserStoryAgentActivity,
  values: Set<string>
) {
  const detail = parseDetailRecord(activity.detail)
  collectPathFields(detail.input, inputPathKeys, values)
  collectPathFields(detail.output, outputPathKeys, values)
}

function collectPathFields(
  value: unknown,
  keys: Set<string>,
  paths: Set<string>,
  depth = 0
) {
  if (depth > 5 || !value || typeof value !== "object") return
  if (Array.isArray(value)) {
    value.forEach((item) => collectPathFields(item, keys, paths, depth + 1))
    return
  }
  Object.entries(value).forEach(([key, item]) => {
    if (keys.has(key)) collectPathValues(item, paths)
    if (item && typeof item === "object") {
      collectPathFields(item, keys, paths, depth + 1)
    }
  })
}

function collectPathValues(value: unknown, paths: Set<string>) {
  const candidates = Array.isArray(value) ? value : [value]
  candidates.forEach((candidate) => {
    const path = canonicalWorkspacePath(candidate)
    if (path) paths.add(path)
  })
}

function canonicalWorkspacePath(value: unknown) {
  if (typeof value !== "string") return undefined
  const path = value.trim().replaceAll("\\", "/").replace(/^\.\//u, "")
  if (!path || path.startsWith("/") || /^[A-Za-z]:\//u.test(path)) {
    return undefined
  }
  if (path.split("/").includes("..") || !workspaceFileName(path)) {
    return undefined
  }
  return /^[\w@+.,/-]+$/u.test(path) ? path : undefined
}

function workspaceFileName(path: string) {
  const name = path.split("/").at(-1) ?? ""
  return (
    /\.[a-z][a-z0-9_-]{0,15}$/iu.test(name) ||
    /^(?:Dockerfile|Makefile|Procfile|CMakeLists\.txt)$/u.test(name)
  )
}

const inputPathKeys = new Set([
  "file_path",
  "from_path",
  "package_path",
  "path",
  "source_path",
  "target_path",
  "to_path",
])

const outputPathKeys = new Set([
  "applied_files",
  "changed_files",
  "created_files",
  "deleted_files",
  "file_path",
  "files",
  "modified_files",
  "path",
])
