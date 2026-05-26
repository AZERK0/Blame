import type { AgentEvent } from "@blame/agent-runtime"

import type {
  UserStory,
  UserStoryAgentActivity,
  UserStoryUpdate,
} from "@/components/backlog/data/backlog-data"

export function agentFlowUpdate(
  story: UserStory,
  event: AgentEvent
): UserStoryUpdate {
  const activity = eventActivity(story.agentActivities ?? [], event)
  const finalResponse = eventFinalResponse(event)
  const update: UserStoryUpdate = {}
  if (activity) update.agentActivities = activity
  if (finalResponse !== undefined) update.agentFinalResponse = finalResponse
  return update
}

export function shouldPersistAgentEvent(event: AgentEvent, update: UserStoryUpdate) {
  if (event.type === "done" || event.type === "error") return true
  if (update.agentActivities || update.agentFinalResponse !== undefined) return true
  return event.type === "approval" || event.type === "tool" || event.type === "reasoning"
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
  if (!text) return activities
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
  const toolCall = recordValue(payload.toolCall)
  const toolCallId =
    stringValue(toolCall.toolCallId) ??
    stringValue(toolCall.id) ??
    stringValue(payload.toolCallId)
  const toolName =
    stringValue(toolCall.toolName) ??
    stringValue(toolCall.name) ??
    stringValue(payload.toolName) ??
    stringValue(payload.name) ??
    "tool"
  const id = toolCallId ? `tool-${toolCallId}` : `tool-${toolName}-${activities.length}`
  return upsertActivity(activities, {
    id,
    kind: "tool",
    title: toolTitle(toolName, phase),
    detail: toolDetail(payload),
    status: toolStatus(phase),
    iteration: numberValue(payload.iteration),
    toolCallId,
  })
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
  input: Omit<UserStoryAgentActivity, "createdAt" | "updatedAt">
) {
  const now = new Date().toISOString()
  const existing = activities.find((activity) => activity.id === input.id)
  const next = existing
    ? { ...existing, ...normalizedActivity(input), updatedAt: now }
    : { ...normalizedActivity(input), createdAt: now }
  if (!existing) return [...activities, next]
  return activities.map((activity) => (activity.id === input.id ? next : activity))
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

function toolDetail(payload: Record<string, unknown>) {
  const toolCall = recordValue(payload.toolCall)
  const detail = {
    durationMs: payload.durationMs,
    input: toolCall.input,
    output: payload.output,
    update: payload.update,
    hookEventName: payload.hookEventName,
    raw: payload.raw,
  }
  return stringifyDetail(detail)
}

function toolEventText(payload: object) {
  if ("toolName" in payload && typeof payload.toolName === "string") {
    return toolLabel(payload.toolName)
  }
  if ("name" in payload && typeof payload.name === "string") {
    return toolLabel(payload.name)
  }
  if (
    "hookEventName" in payload &&
    typeof payload.hookEventName === "string"
  ) {
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
  if (value && typeof value === "object") return value as Record<string, unknown>
  return {}
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : undefined
}

function stringifyDetail(value: unknown) {
  return truncate(JSON.stringify(value, undefined, 2), 32768)
}

function normalizedActivity(
  activity: Omit<UserStoryAgentActivity, "createdAt" | "updatedAt">
) {
  return {
    ...activity,
    title: truncate(activity.title, 255),
    detail: truncate(activity.detail, 32768),
  }
}

function truncate(value: string, length: number) {
  return value.length > length ? value.slice(0, length) : value
}
