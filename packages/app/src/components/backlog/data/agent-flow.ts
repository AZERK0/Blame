import type { AgentEvent } from "@blame/agent-runtime"

import type {
  UserStory,
  UserStoryAgentActivity,
  UserStoryAgentUsage,
  UserStoryUpdate,
} from "@/components/backlog/data/backlog-data"

const maxActivities = 80
const maxActivityDetailLength = 4096
const maxActivityValueLength = 1400
const maxServerActivityDetailLength = 262144
type ActivityInput = Omit<UserStoryAgentActivity, "createdAt" | "updatedAt"> & {
  serverDetail?: string
}
type ActivityUpdate = {
  activities: UserStoryAgentActivity[]
  activity: UserStoryAgentActivity
  activityUpdates: UserStoryAgentActivity[]
}

export function agentFlowUpdate(
  story: UserStory,
  event: AgentEvent
): UserStoryUpdate {
  const activity = eventActivity(story.agentActivities ?? [], event)
  const finalResponse = eventFinalResponse(event)
  const usage = eventUsage(story, event)
  const sessionSummary = eventSessionSummary(story, event)
  const update: UserStoryUpdate = {}
  if (activity) {
    update.agentActivities = activity.activities
    update.agentActivity = activity.activity
    update.agentActivityUpdates = activity.activityUpdates
  }
  if (finalResponse !== undefined) update.agentFinalResponse = finalResponse
  if (usage) update.agentUsage = usage
  if (sessionSummary !== undefined) update.agentSessionSummary = sessionSummary
  return update
}

export function shouldPersistAgentEvent(
  event: AgentEvent,
  update: UserStoryUpdate
) {
  if (event.type === "done" || event.type === "error") return true
  if (
    update.agentActivities ||
    update.agentFinalResponse !== undefined ||
    update.agentUsage ||
    update.agentSessionSummary !== undefined
  )
    return true
  return (
    event.type === "approval" ||
    event.type === "tool" ||
    event.type === "reasoning"
  )
}

export function agentEventText(event: AgentEvent) {
  if (!event.payload || typeof event.payload !== "object") return ""
  if (event.type === "tool") return toolEventText(event.payload)
  if (event.type === "approval") return approvalEventText(event.payload)
  if ("text" in event.payload && typeof event.payload.text === "string") {
    return event.payload.text
  }
  if ("message" in event.payload && typeof event.payload.message === "string") {
    return event.payload.message
  }
  if ("error" in event.payload && typeof event.payload.error === "string") {
    return event.payload.error
  }
  return ""
}

export function completedAgentRun(event: AgentEvent) {
  if (event.type !== "done") return false
  if (!event.payload || typeof event.payload !== "object") return true
  if ("reason" in event.payload && typeof event.payload.reason === "string") {
    return !failedDoneReason(event.payload.reason)
  }
  if ("status" in event.payload && typeof event.payload.status === "string") {
    return !failedDoneReason(event.payload.status)
  }
  return true
}

function eventActivity(
  activities: UserStoryAgentActivity[],
  event: AgentEvent
) {
  if (event.type === "reasoning") return reasoningActivities(activities, event)
  if (event.type === "text") return messageActivities(activities, event)
  if (event.type === "tool") return toolActivities(activities, event)
  if (event.type === "approval") return approvalActivities(activities, event)
}

function reasoningActivities(
  activities: UserStoryAgentActivity[],
  event: AgentEvent
) {
  const payload = eventPayload(event)
  const iteration = numberValue(payload.iteration)
  const id = `reasoning-${iteration ?? "session"}`
  const text = reasoningText(activities, id, payload)
  if (!text) return undefined
  return upsertActivity(activities, {
    id,
    kind: "reasoning",
    title: iteration ? `Agent reasoning ${iteration}` : "Agent reasoning",
    detail: text,
    status: "running",
    iteration,
  })
}

function reasoningText(
  activities: UserStoryAgentActivity[],
  id: string,
  payload: Record<string, unknown>
) {
  const accumulatedText = stringValue(payload.accumulatedText)
  if (accumulatedText !== undefined) return accumulatedText
  const reasoning = stringValue(payload.reasoning)
  if (reasoning !== undefined) return reasoning
  const text = stringValue(payload.text)
  if (text === undefined) return undefined
  const existing = activities.find((activity) => activity.id === id)
  return appendStreamingText(existing?.detail, text)
}

function appendStreamingText(current: string | undefined, next: string) {
  if (!current) return next
  if (next.startsWith(current)) return next
  return `${current}${next}`
}

function messageActivities(
  activities: UserStoryAgentActivity[],
  event: AgentEvent
) {
  const payload = eventPayload(event)
  const iteration = numberValue(payload.iteration)
  const id = messageActivityId(activities, iteration)
  const existing = activities.find((activity) => activity.id === id)
  const text = messageText(existing?.detail, payload)
  if (text === undefined || !text.trim()) return undefined
  const messageKind = agentMessageKind(payload)
  return upsertActivity(activities, {
    id,
    kind: "message",
    title: messageKind === "final" ? "Agent response" : "Agent message",
    detail: text,
    status: "completed",
    iteration,
    messageKind,
  })
}

function messageActivityId(
  activities: UserStoryAgentActivity[],
  iteration: number | undefined
) {
  const last = activities.at(-1)
  if (last?.kind === "message" && sameIteration(last.iteration, iteration)) {
    return last.id
  }
  const count = activities.filter(
    (activity) =>
      activity.kind === "message" &&
      sameIteration(activity.iteration, iteration)
  ).length
  return `message-${iteration ?? "session"}-${count + 1}`
}

function messageText(
  current: string | undefined,
  payload: Record<string, unknown>
) {
  const accumulatedText = stringValue(payload.accumulatedText)
  if (accumulatedText !== undefined) return accumulatedText
  const text = stringValue(payload.text)
  if (text !== undefined) return appendStreamingText(current, text)
  return stringValue(payload.message)
}

function agentMessageKind(payload: Record<string, unknown>) {
  return stringValue(payload.finishReason) === "stop" ? "final" : "intermediate"
}

function toolActivities(
  activities: UserStoryAgentActivity[],
  event: AgentEvent
) {
  const payload = eventPayload(event)
  const phase = stringValue(payload.phase) ?? stringValue(payload.hookEventName)
  const input = toolActivityInput(activities, payload, phase)
  return upsertActivities(
    activities,
    toolActivityInputs(activities, phase, input)
  )
}

function toolActivityInput(
  activities: UserStoryAgentActivity[],
  payload: Record<string, unknown>,
  phase: string | undefined
): ActivityInput {
  const toolCall = recordValue(payload.toolCall)
  const toolCallId = eventToolCallId(payload, toolCall)
  const toolName = eventToolName(payload, toolCall)
  const iteration = numberValue(payload.iteration)
  const id = toolActivityId(activities, toolName, iteration, phase, toolCallId)
  const existing = activities.find((activity) => activity.id === id)
  return {
    id,
    kind: "tool",
    title: toolTitle(toolName, phase),
    detail: toolDetail(payload, true),
    serverDetail: toolDetail(payload, false),
    status: toolStatus(phase),
    iteration,
    parallelGroupId: existing?.parallelGroupId,
    toolCallId,
    toolName,
  }
}

function eventToolCallId(
  payload: Record<string, unknown>,
  toolCall: Record<string, unknown>
) {
  return (
    stringValue(toolCall.toolCallId) ??
    stringValue(toolCall.id) ??
    stringValue(payload.toolCallId)
  )
}

function eventToolName(
  payload: Record<string, unknown>,
  toolCall: Record<string, unknown>
) {
  return (
    stringValue(toolCall.toolName) ??
    stringValue(toolCall.name) ??
    stringValue(payload.toolName) ??
    stringValue(payload.name) ??
    "tool"
  )
}

function toolActivityId(
  activities: UserStoryAgentActivity[],
  toolName: string,
  iteration: number | undefined,
  phase: string | undefined,
  toolCallId: string | undefined
) {
  return toolCallId
    ? `tool-${toolCallId}`
    : (matchingToolId(activities, toolName, iteration, phase) ??
        `tool-${toolName}-${activities.length}`)
}

function matchingToolId(
  activities: UserStoryAgentActivity[],
  toolName: string,
  iteration: number | undefined,
  phase: string | undefined
) {
  return activities.findLast(
    (activity) =>
      activity.kind === "tool" &&
      activity.toolName === toolName &&
      activity.iteration === iteration &&
      (toolStatus(phase) === "completed" || activity.status === "running")
  )?.id
}

function approvalActivities(
  activities: UserStoryAgentActivity[],
  event: AgentEvent
) {
  const payload = eventPayload(event)
  const toolName = stringValue(payload.toolName) ?? "tool"
  const id = `approval-${stringValue(payload.id) ?? `${toolName}-${activities.length}`}`
  return upsertActivity(activities, {
    id,
    kind: "approval",
    title: `Tool approval requested: ${toolName}`,
    detail: stringifyDetail(payload.input ?? payload),
    status: "running",
  })
}

function eventFinalResponse(event: AgentEvent) {
  if (event.type !== "done") return undefined
  const payload = eventPayload(event)
  const text = stringValue(payload.text)
  return text?.trim() || undefined
}

function upsertActivity(
  activities: UserStoryAgentActivity[],
  input: ActivityInput
) {
  return upsertActivities(activities, [input])
}

function upsertActivities(
  activities: UserStoryAgentActivity[],
  inputs: ActivityInput[]
): ActivityUpdate {
  const updates: UserStoryAgentActivity[] = []
  const nextActivities = inputs.reduce((currentActivities, input) => {
    const next = upsertActivityValue(currentActivities, input)
    updates.push(next.activity)
    return next.activities
  }, activities)
  return {
    activities: limitActivities(nextActivities),
    activity: updates[updates.length - 1],
    activityUpdates: updates,
  }
}

function upsertActivityValue(
  activities: UserStoryAgentActivity[],
  input: ActivityInput
) {
  const now = new Date().toISOString()
  const { serverDetail, ...activityInput } = input
  const existing = activities.find((activity) => activity.id === input.id)
  const next = existing
    ? { ...existing, ...normalizedActivity(activityInput), updatedAt: now }
    : { ...normalizedActivity(activityInput), createdAt: now }
  const serverActivity = serverDetail ? { ...next, detail: serverDetail } : next
  const nextActivities = existing
    ? activities.map((activity) => (activity.id === input.id ? next : activity))
    : [...activities, next]
  return { activities: nextActivities, activity: serverActivity }
}

function toolActivityInputs(
  activities: UserStoryAgentActivity[],
  phase: string | undefined,
  input: ActivityInput
) {
  const groupId = parallelGroupId(activities, phase, input)
  const toolInput = groupId ? { ...input, parallelGroupId: groupId } : input
  if (!groupId || toolStatus(phase) !== "running") return [toolInput]
  return [
    ...parallelRunningTools(activities, input).map((activity) =>
      groupedActivityInput(activity, groupId)
    ),
    toolInput,
  ]
}

function parallelGroupId(
  activities: UserStoryAgentActivity[],
  phase: string | undefined,
  input: ActivityInput
) {
  if (toolStatus(phase) !== "running") return input.parallelGroupId
  const tools = parallelRunningTools(activities, input)
  if (!tools.length) return input.parallelGroupId
  return (
    input.parallelGroupId ??
    tools.find((activity) => activity.parallelGroupId)?.parallelGroupId ??
    `parallel-tools-${input.iteration ?? "session"}-${tools[0].id}`
  )
}

function parallelRunningTools(
  activities: UserStoryAgentActivity[],
  input: ActivityInput
) {
  return activities.filter(
    (activity) =>
      activity.id !== input.id &&
      activity.kind === "tool" &&
      activity.status === "running" &&
      sameIteration(activity.iteration, input.iteration)
  )
}

function sameIteration(left: number | undefined, right: number | undefined) {
  if (left !== undefined || right !== undefined) return left === right
  return true
}

function groupedActivityInput(
  activity: UserStoryAgentActivity,
  parallelGroupId: string
): ActivityInput {
  const { createdAt, updatedAt, ...input } = activity
  void createdAt
  void updatedAt
  return { ...input, parallelGroupId }
}

function toolTitle(toolName: string, phase: string | undefined) {
  const label = toolLabel(toolName)
  if (phase === "started" || phase === "tool_call") return `${label} started`
  if (phase === "finished" || phase === "tool_result") return label
  if (phase === "updated") return `${label} updated`
  return label
}

function toolStatus(phase: string | undefined) {
  if (phase === "finished" || phase === "tool_result") return "completed"
  if (phase === "agent_error") return "failed"
  return "running"
}

function toolDetail(payload: Record<string, unknown>, compact: boolean) {
  const toolCall = recordValue(payload.toolCall)
  const detail = {
    durationMs: payload.durationMs,
    toolName: stringValue(toolCall.name) ?? stringValue(toolCall.toolName),
    input: compact ? compactValue(toolCall.input) : toolCall.input,
    output: compact ? compactValue(payload.output) : payload.output,
    update: compact ? compactValue(payload.update) : payload.update,
    hookEventName: payload.hookEventName,
  }
  return stringifyDetail(
    detail,
    compact ? maxActivityDetailLength : maxServerActivityDetailLength
  )
}

function toolEventText(payload: object) {
  if ("toolName" in payload && typeof payload.toolName === "string") {
    return toolLabel(payload.toolName)
  }
  if ("name" in payload && typeof payload.name === "string") {
    return toolLabel(payload.name)
  }
  if ("hookEventName" in payload && typeof payload.hookEventName === "string") {
    return `Tool event: ${payload.hookEventName}`
  }
  return "Tool event"
}

function toolLabel(toolName: string) {
  if (toolName === "run_commands") return "Ran terminal command"
  if (toolName === "read_files") return "Read files"
  if (toolName === "search_codebase") return "Searched codebase"
  if (toolName === "apply_patch") return "Edited files"
  if (toolName === "write_file") return "Wrote file"
  if (toolName === "list_files") return "Listed files"
  return humanizeToolName(toolName)
}

function humanizeToolName(toolName: string) {
  return toolName
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function approvalEventText(payload: object) {
  if ("toolName" in payload && typeof payload.toolName === "string") {
    return `Tool approval requested: ${payload.toolName}`
  }
  return "Tool approval requested"
}

function failedDoneReason(reason: string) {
  return ["error", "aborted", "cancelled", "failed"].includes(reason)
}

function eventPayload(event: AgentEvent) {
  if (event.payload && typeof event.payload === "object") {
    return event.payload as Record<string, unknown>
  }
  return {}
}

function recordValue(value: unknown) {
  if (value && typeof value === "object")
    return value as Record<string, unknown>
  return {}
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : undefined
}

function stringifyDetail(value: unknown, length = maxActivityDetailLength) {
  return truncateMiddle(JSON.stringify(value, undefined, 2), length)
}

function normalizedActivity(
  activity: Omit<UserStoryAgentActivity, "createdAt" | "updatedAt">
) {
  return {
    ...activity,
    title: truncate(activity.title, 255),
    detail: truncateMiddle(activity.detail, maxActivityDetailLength),
  }
}

function truncate(value: string, length: number) {
  return value.length > length ? value.slice(0, length) : value
}

function limitActivities(activities: UserStoryAgentActivity[]) {
  return activities.slice(Math.max(0, activities.length - maxActivities))
}

function compactValue(value: unknown): unknown {
  if (value === undefined || value === null) return value
  if (typeof value === "string") return compactString(value)
  if (Array.isArray(value)) return compactArray(value)
  if (typeof value === "object") return compactRecord(value)
  return value
}

function eventUsage(story: UserStory, event: AgentEvent) {
  const current = usageWithDefaults(story.agentUsage)
  if (event.type === "usage" || event.type === "done") {
    const next = usageFromUsageEvent(current, event)
    return usageChanged(current, next) ? next : undefined
  }
}

function usageFromUsageEvent(current: UserStoryAgentUsage, event: AgentEvent) {
  const payload = eventPayload(event)
  const payloadUsage = recordValue(payload.usage)
  const usage = Object.keys(payloadUsage).length ? payloadUsage : payload
  return {
    ...current,
    cacheReadTokens:
      numberValue(usage.cacheReadTokens) ?? current.cacheReadTokens,
    cacheWriteTokens:
      numberValue(usage.cacheWriteTokens) ?? current.cacheWriteTokens,
    cost: numberValue(usage.cost) ?? current.cost,
    inputTokens: numberValue(usage.inputTokens) ?? current.inputTokens,
    outputTokens: numberValue(usage.outputTokens) ?? current.outputTokens,
    totalCacheReadTokens:
      numberValue(usage.totalCacheReadTokens) ?? current.totalCacheReadTokens,
    totalCacheWriteTokens:
      numberValue(usage.totalCacheWriteTokens) ?? current.totalCacheWriteTokens,
    totalCost: numberValue(usage.totalCost) ?? current.totalCost,
    totalInputTokens:
      numberValue(usage.totalInputTokens) ?? current.totalInputTokens,
    totalOutputTokens:
      numberValue(usage.totalOutputTokens) ?? current.totalOutputTokens,
  }
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

function eventSessionSummary(story: UserStory, event: AgentEvent) {
  if (event.type !== "done" && event.type !== "error") return undefined
  const activities = story.agentActivities ?? []
  const files = fileMentions(activities)
  const tools = toolNames(activities)
  const status = completedAgentRun(event) ? "completed" : "failed"
  return [
    `Session ${status}.`,
    files.length ? `Files touched or inspected: ${files.join(", ")}.` : "",
    tools.length ? `Tools used: ${tools.join(", ")}.` : "",
    story.agentLastError ? `Last error: ${story.agentLastError}` : "",
    "Resume by inspecting the current git diff before making changes.",
  ]
    .filter(Boolean)
    .join("\n")
}

function emptyUsage(): UserStoryAgentUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  }
}

function usageWithDefaults(usage: UserStoryAgentUsage | null | undefined) {
  return { ...emptyUsage(), ...usage }
}

function fileMentions(activities: UserStoryAgentActivity[]) {
  return uniqueMatches(activities, /(?:^|["\s])([\w./-]+\.\w{1,8})(?:["\s]|$)/g)
}

function toolNames(activities: UserStoryAgentActivity[]) {
  return Array.from(
    new Set(
      activities
        .filter((activity) => activity.kind === "tool")
        .map((activity) => activity.title)
    )
  ).slice(0, 8)
}

function uniqueMatches(activities: UserStoryAgentActivity[], pattern: RegExp) {
  const values = new Set<string>()
  activities.forEach((activity) => {
    for (const match of activity.detail.matchAll(pattern)) {
      if (match[1]) values.add(match[1])
    }
  })
  return Array.from(values).slice(0, 12)
}

function compactArray(value: unknown[]) {
  const items = value.slice(0, 12).map(compactValue)
  if (value.length <= items.length) return items
  return [
    ...items,
    compactString(`${value.length - items.length} more entries`),
  ]
}

function compactRecord(value: object) {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, compactValue(entry)])
  )
}

function compactString(value: string) {
  if (value.length <= maxActivityValueLength) return value
  return {
    excerpt: truncateMiddle(value, maxActivityValueLength),
    originalLength: value.length,
    truncated: true,
  }
}

function truncateMiddle(value: string, length: number) {
  if (value.length <= length) return value
  const edgeLength = Math.floor((length - 20) / 2)
  return `${value.slice(0, edgeLength)}\n...\n${value.slice(-edgeLength)}`
}
