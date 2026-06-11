import type { AgentEvent } from "@blame/agent-runtime"

import type {
  UserStory,
  UserStoryAgentActivity,
  UserStoryAgentToolUsage,
  UserStoryAgentUsage,
  UserStoryUpdate,
} from "@/components/backlog/data/backlog-data"

const maxActivities = 80
const maxActivityDetailLength = 4096
const maxActivityValueLength = 1400
const maxServerActivityDetailLength = 262144
const largeFileReadBytes = 24000
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
  if (event.type === "tool") return toolActivities(activities, event)
  if (event.type === "approval") return approvalActivities(activities, event)
}

function reasoningActivities(
  activities: UserStoryAgentActivity[],
  event: AgentEvent
) {
  const payload = eventPayload(event)
  const iteration = numberValue(payload.iteration)
  const text =
    stringValue(payload.accumulatedText) ??
    stringValue(payload.reasoning) ??
    stringValue(payload.text)
  if (!text) return undefined
  const id = `reasoning-${iteration ?? "session"}`
  return upsertActivity(activities, {
    id,
    kind: "reasoning",
    title: iteration ? `Agent reasoning ${iteration}` : "Agent reasoning",
    detail: text,
    status: "running",
    iteration,
  })
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
  if (event.type === "tool") return usageFromToolEvent(current, event)
  if (event.type === "notice") return usageFromNoticeEvent(current, event)
}

function usageFromUsageEvent(current: UserStoryAgentUsage, event: AgentEvent) {
  const payload = eventPayload(event)
  const payloadUsage = recordValue(payload.usage)
  const usage = Object.keys(payloadUsage).length ? payloadUsage : payload
  const aggregateUsage = aggregateUsageEvent(event, payload)
  const currentInputTokens = aggregateUsage
    ? (current.currentInputTokens ?? 0)
    : (numberValue(usage.inputTokens) ?? current.currentInputTokens ?? 0)
  const currentOutputTokens = aggregateUsage
    ? (current.currentOutputTokens ?? 0)
    : (numberValue(usage.outputTokens) ?? current.currentOutputTokens ?? 0)
  const inputTokens =
    numberValue(usage.totalInputTokens) ??
    numberValue(usage.inputTokens) ??
    current.inputTokens
  const outputTokens =
    numberValue(usage.totalOutputTokens) ??
    numberValue(usage.outputTokens) ??
    current.outputTokens
  const cacheReadTokens =
    numberValue(usage.cacheReadTokens) ?? current.cacheReadTokens
  const cacheWriteTokens =
    numberValue(usage.cacheWriteTokens) ?? current.cacheWriteTokens
  const currentTotalTokens = aggregateUsage
    ? (current.currentTotalTokens ?? currentInputTokens + currentOutputTokens)
    : (numberValue(usage.totalTokens) ??
      currentInputTokens + currentOutputTokens)
  const sessionTotalTokens = inputTokens + outputTokens
  const rawTotalTokens = sessionTotalTokens + cacheReadTokens + cacheWriteTokens
  const maxContextTokens = Math.max(
    current.maxContextTokens,
    currentInputTokens
  )
  return {
    ...current,
    cacheReadTokens,
    cacheWriteTokens,
    currentInputTokens,
    currentOutputTokens,
    currentTotalTokens,
    inputTokens,
    maxContextTokens,
    outputTokens,
    rawTotalTokens,
    sessionTotalTokens,
    totalCost: numberValue(usage.totalCost) ?? current.totalCost,
  }
}

function aggregateUsageEvent(
  event: AgentEvent,
  payload: Record<string, unknown>
) {
  if (event.type === "done") return true
  const raw = recordValue(payload.raw)
  return stringValue(raw.type) === "usage-updated"
}

function usageChanged(current: UserStoryAgentUsage, next: UserStoryAgentUsage) {
  return (
    current.cacheReadTokens !== next.cacheReadTokens ||
    current.cacheWriteTokens !== next.cacheWriteTokens ||
    current.currentInputTokens !== next.currentInputTokens ||
    current.currentOutputTokens !== next.currentOutputTokens ||
    current.currentTotalTokens !== next.currentTotalTokens ||
    current.inputTokens !== next.inputTokens ||
    current.maxContextTokens !== next.maxContextTokens ||
    current.outputTokens !== next.outputTokens ||
    current.rawTotalTokens !== next.rawTotalTokens ||
    current.sessionTotalTokens !== next.sessionTotalTokens ||
    current.totalCost !== next.totalCost
  )
}

function usageFromToolEvent(current: UserStoryAgentUsage, event: AgentEvent) {
  const payload = eventPayload(event)
  const phase = stringValue(payload.phase) ?? stringValue(payload.hookEventName)
  if (phase !== "finished" && phase !== "tool_result") return
  const toolCall = recordValue(payload.toolCall)
  const toolName =
    stringValue(toolCall.name) ??
    stringValue(toolCall.toolName) ??
    stringValue(payload.toolName) ??
    "tool"
  const bytes = valueLength(payload.output ?? payload.update)
  const saved = Math.max(0, bytes - maxActivityValueLength)
  const readFiles = readFilesUsage(toolName, toolCall.input, bytes)
  return {
    ...current,
    largeFileReads: current.largeFileReads + readFiles.largeFileReads,
    tokensSavedEstimate: current.tokensSavedEstimate + Math.ceil(saved / 3),
    topTools: topTools(current.topTools, toolName, bytes, saved > 0),
    truncatedOutputs: current.truncatedOutputs + (saved > 0 ? 1 : 0),
    unboundedFileReads:
      current.unboundedFileReads + readFiles.unboundedFileReads,
  }
}

function readFilesUsage(toolName: string, input: unknown, bytes: number) {
  if (toolName !== "read_files")
    return { largeFileReads: 0, unboundedFileReads: 0 }
  const unboundedFileReads =
    readFileRequests(input).filter(unboundedRead).length
  return {
    largeFileReads: bytes > largeFileReadBytes ? 1 : 0,
    unboundedFileReads,
  }
}

type ReadFileRequest = {
  endLine?: number
  startLine?: number
}

function readFileRequests(value: unknown): ReadFileRequest[] {
  if (Array.isArray(value)) return value.flatMap(readFileRequests)
  if (typeof value === "string") return [{}]
  const record = recordValue(value)
  if (!Object.keys(record).length) return []
  const nested = readFileNestedRequests(record)
  if (nested.length) return nested
  if (!("path" in record) && !("relativePath" in record)) return []
  return [
    {
      endLine: numberValue(record.end_line) ?? numberValue(record.endLine),
      startLine:
        numberValue(record.start_line) ?? numberValue(record.startLine),
    },
  ]
}

function readFileNestedRequests(record: Record<string, unknown>) {
  return ["files", "file_paths", "paths"].flatMap((key) =>
    key in record ? readFileRequests(record[key]) : []
  )
}

function unboundedRead(request: ReadFileRequest) {
  return request.startLine === undefined && request.endLine === undefined
}

function usageFromNoticeEvent(current: UserStoryAgentUsage, event: AgentEvent) {
  const payload = eventPayload(event)
  const message = stringValue(payload.message)?.toLowerCase() ?? ""
  if (!message.includes("compact")) return
  return { ...current, compactionCount: current.compactionCount + 1 }
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
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    compactionCount: 0,
    currentInputTokens: 0,
    currentOutputTokens: 0,
    currentTotalTokens: 0,
    inputTokens: 0,
    largeFileReads: 0,
    maxContextTokens: 0,
    outputTokens: 0,
    rawTotalTokens: 0,
    sessionTotalTokens: 0,
    unboundedFileReads: 0,
    tokensSavedEstimate: 0,
    topTools: [],
    totalCost: 0,
    truncatedOutputs: 0,
  }
}

function usageWithDefaults(usage: UserStoryAgentUsage | null | undefined) {
  return { ...emptyUsage(), ...usage }
}

function topTools(
  current: UserStoryAgentToolUsage[],
  name: string,
  bytes: number,
  truncated: boolean
) {
  const existing = current.find((tool) => tool.name === name)
  const next = existing
    ? current.map((tool) =>
        tool.name === name
          ? {
              ...tool,
              count: tool.count + 1,
              maxBytes: Math.max(tool.maxBytes, bytes),
              totalBytes: tool.totalBytes + bytes,
              truncatedCount: tool.truncatedCount + (truncated ? 1 : 0),
            }
          : tool
      )
    : [
        ...current,
        {
          count: 1,
          maxBytes: bytes,
          name,
          totalBytes: bytes,
          truncatedCount: truncated ? 1 : 0,
        },
      ]
  return next.sort((a, b) => b.totalBytes - a.totalBytes).slice(0, 5)
}

function valueLength(value: unknown): number {
  if (typeof value === "string") return value.length
  if (value === undefined || value === null) return 0
  return JSON.stringify(value).length
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
