import { publicAssetUrl } from "../../../lib/public-asset-url.ts"

import type { AgentEvent } from "@blame/agent-runtime"

import type {
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
type ActivityKind = UserStoryAgentActivity["kind"]
type ActivityStatus = NonNullable<UserStoryAgentActivity["status"]>
type ActivityUpdate = {
  activities: UserStoryAgentActivity[]
  activity: UserStoryAgentActivity
  activityUpdates: UserStoryAgentActivity[]
}
export type AgentFlowState = {
  agentActivities?: UserStoryAgentActivity[] | null
  agentFinalResponse?: string | null
  agentLastError?: string | null
  agentSessionSummary?: string | null
  agentUsage?: UserStoryAgentUsage | null
}
export type AgentFlowUpdate = Pick<
  UserStoryUpdate,
  | "agentActivities"
  | "agentActivity"
  | "agentActivityUpdates"
  | "agentFinalResponse"
  | "agentSessionSummary"
  | "agentUsage"
>

export function agentFlowUpdate(
  story: AgentFlowState,
  event: AgentEvent
): AgentFlowUpdate {
  const activity = eventActivity(story.agentActivities ?? [], event)
  const nextActivities = activity?.activities ?? story.agentActivities ?? []
  const finalResponse = eventFinalResponse(nextActivities, event)
  const usage = eventUsage(story, event)
  const sessionSummary = eventSessionSummary(story, event)
  const update: AgentFlowUpdate = {}
  if (activity) {
    update.agentActivities = activity.activities
    update.agentActivity = activity.activity
    update.agentActivityUpdates = activity.activityUpdates
  }
  if (finalResponse !== undefined) {
    const finalActivity = finalResponseActivity(
      update.agentActivities ?? story.agentActivities ?? [],
      finalResponse
    )
    if (finalActivity) {
      update.agentActivities = finalActivity.activities
      update.agentActivity = finalActivity.activity
      update.agentActivityUpdates = appendActivityUpdate(
        update.agentActivityUpdates,
        finalActivity.activity
      )
    }
    update.agentFinalResponse = finalResponse
  }
  if (usage) update.agentUsage = usage
  if (sessionSummary !== undefined) update.agentSessionSummary = sessionSummary
  return update
}

function appendActivityUpdate(
  updates: UserStoryAgentActivity[] | undefined,
  activity: UserStoryAgentActivity
) {
  const current = updates ?? []
  const existingIndex = current.findIndex((item) => item.id === activity.id)
  if (existingIndex === -1) return [...current, activity]
  return current.map((item, index) =>
    index === existingIndex ? activity : item
  )
}

export function shouldPersistAgentEvent(
  event: AgentEvent,
  update: AgentFlowUpdate
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
  const reason = doneReason(event.payload as Record<string, unknown>)
  if (!reason) return true
  return completedDoneReason(reason)
}

export function failedAgentRun(event: AgentEvent) {
  if (event.type === "error") return true
  if (event.type !== "done") return false
  if (!event.payload || typeof event.payload !== "object") return false
  const reason = doneReason(event.payload as Record<string, unknown>)
  return reason ? failedDoneReason(reason) : false
}

export function terminalAgentRunEvent(event: AgentEvent) {
  return completedAgentRun(event) || failedAgentRun(event)
}

function eventActivity(
  activities: UserStoryAgentActivity[],
  event: AgentEvent
) {
  if (event.type === "reasoning") return reasoningActivities(activities, event)
  if (event.type === "text") return messageActivities(activities, event)
  if (event.type === "tool") return toolActivities(activities, event)
  if (event.type === "approval") return approvalActivities(activities, event)
  if (event.type === "done")
    return closeRunningActivities(activities, ["message", "reasoning", "tool"])
}

function reasoningActivities(
  activities: UserStoryAgentActivity[],
  event: AgentEvent
) {
  const payload = eventPayload(event)
  const iteration = numberValue(payload.iteration)
  const phase = streamPhase(payload)
  if (closingStreamPhase(phase)) {
    return closeRunningActivities(activities, ["reasoning"])
  }
  const id = inlineActivityId(activities, "reasoning", iteration)
  const text = reasoningText(activities, id, payload)
  if (!text) return undefined
  return upsertActivities(activities, [
    ...closeRunningActivityInputs(activities, ["message", "tool"]),
    {
      id,
      kind: "reasoning",
      title: iteration ? `Agent reasoning ${iteration}` : "Agent reasoning",
      detail: text,
      status: "running" as const,
      iteration,
    },
  ])
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
  const phase = streamPhase(payload)
  if (closingStreamPhase(phase)) {
    return closeRunningActivities(activities, ["message"])
  }
  const id = messageActivityId(activities, iteration, payload)
  const text = messageText(activities, id, iteration, payload)
  if (text === undefined || !text.trim()) return undefined
  const messageKind = agentMessageKind()
  return upsertActivities(activities, [
    ...closeRunningActivityInputs(activities, ["reasoning", "tool"]),
    {
      id,
      kind: "message",
      title: messageKind === "final" ? "Agent response" : "Agent message",
      detail: text,
      status: messageKind === "final" ? "completed" : ("running" as const),
      iteration,
      messageKind,
    },
  ])
}

function messageActivityId(
  activities: UserStoryAgentActivity[],
  iteration: number | undefined,
  payload: Record<string, unknown>
) {
  const active = inlineActivity(activities, "message", iteration)
  if (active) return active.id
  const accumulatedText = stringValue(payload.accumulatedText)
  const lastActivity = activities.at(-1)
  if (
    accumulatedText !== undefined &&
    reusableClosedMessage(lastActivity, iteration, accumulatedText)
  ) {
    return lastActivity.id
  }
  return nextInlineActivityId(activities, "message", iteration)
}

function inlineActivityId(
  activities: UserStoryAgentActivity[],
  kind: "message" | "reasoning",
  iteration: number | undefined
) {
  const active = inlineActivity(activities, kind, iteration)
  if (active) return active.id
  return nextInlineActivityId(activities, kind, iteration)
}

function inlineActivity(
  activities: UserStoryAgentActivity[],
  kind: "message" | "reasoning",
  iteration: number | undefined
) {
  return lastMatchingActivity(
    activities,
    (activity) =>
      activity.kind === kind &&
      activity.status === "running" &&
      sameIteration(activity.iteration, iteration)
  )
}

function nextInlineActivityId(
  activities: UserStoryAgentActivity[],
  kind: "message" | "reasoning",
  iteration: number | undefined
) {
  const label = kind === "message" ? "message" : "reasoning"
  const count = activities.filter(
    (activity) =>
      activity.kind === kind && sameIteration(activity.iteration, iteration)
  ).length
  return `${label}-${iteration ?? "session"}-${count + 1}`
}

function reusableClosedMessage(
  activity: UserStoryAgentActivity | undefined,
  iteration: number | undefined,
  accumulatedText: string
) {
  return (
    activity?.kind === "message" &&
    sameIteration(activity.iteration, iteration) &&
    sameStreamingResponse(activity.detail, accumulatedText)
  )
}

function lastMatchingActivity(
  activities: UserStoryAgentActivity[],
  predicate: (activity: UserStoryAgentActivity) => boolean
) {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index]
    if (activity && predicate(activity)) return activity
  }
}

function streamPhase(payload: Record<string, unknown>) {
  return stringValue(payload.phase) ?? stringValue(payload.hookEventName)
}

function closingStreamPhase(phase: string | undefined) {
  return (
    phase === "finished" ||
    phase === "content_end" ||
    phase === "end" ||
    phase === "done"
  )
}

function closeRunningActivities(
  activities: UserStoryAgentActivity[],
  kinds: ActivityKind[]
) {
  const inputs = closeRunningActivityInputs(activities, kinds)
  if (!inputs.length) return undefined
  return upsertActivities(activities, inputs)
}

function closeRunningActivityInputs(
  activities: UserStoryAgentActivity[],
  kinds: ActivityKind[]
): ActivityInput[] {
  return activities
    .filter(
      (activity) =>
        activity.status === "running" && kinds.includes(activity.kind)
    )
    .map((activity) => {
      const { createdAt, updatedAt, ...input } = activity
      void createdAt
      void updatedAt
      return { ...input, status: "completed" as const }
    })
}

function messageText(
  activities: UserStoryAgentActivity[],
  id: string,
  iteration: number | undefined,
  payload: Record<string, unknown>
) {
  const current = activities.find((activity) => activity.id === id)?.detail
  const accumulatedText = stringValue(payload.accumulatedText)
  if (accumulatedText !== undefined) {
    return currentMessageAccumulatedText(
      activities,
      id,
      iteration,
      accumulatedText
    )
  }
  const text = stringValue(payload.text)
  if (text !== undefined) return appendStreamingText(current, text)
  return stringValue(payload.message)
}

function currentMessageAccumulatedText(
  activities: UserStoryAgentActivity[],
  id: string,
  iteration: number | undefined,
  accumulatedText: string
) {
  const previousText = previousMessageText(activities, id, iteration)
  if (!previousText) return accumulatedText
  const normalizedText = normalizedStreamedMessageLineEndings(accumulatedText)
  const normalizedPreviousText =
    normalizedStreamedMessageLineEndings(previousText)
  const prefixLength = accumulatedPrefixLength(
    normalizedText,
    normalizedPreviousText
  )
  if (prefixLength === undefined) return accumulatedText
  if (!safeAccumulatedPrefixBoundary(normalizedText, prefixLength)) {
    return accumulatedText
  }
  return normalizedText.slice(prefixLength).trimStart()
}

function previousMessageText(
  activities: UserStoryAgentActivity[],
  id: string,
  iteration: number | undefined
) {
  return activities
    .filter(
      (activity) =>
        activity.id !== id &&
        activity.kind === "message" &&
        sameIteration(activity.iteration, iteration)
    )
    .map((activity) => activity.detail)
    .join("")
}

function accumulatedPrefixLength(value: string, prefix: string) {
  if (value.startsWith(prefix)) return prefix.length
  const compactPrefix = prefix.trimEnd()
  if (compactPrefix && value.startsWith(compactPrefix)) {
    return compactPrefix.length
  }
  return undefined
}

function safeAccumulatedPrefixBoundary(value: string, index: number) {
  if (index <= 0) return false
  if (index >= value.length) return true
  return /\s/.test(value[index - 1] ?? "") || /\s/.test(value[index] ?? "")
}

function agentMessageKind() {
  return "intermediate"
}

function finalResponseActivity(
  activities: UserStoryAgentActivity[],
  finalResponse: string
) {
  const existing = finalResponseMessageActivity(activities, finalResponse)
  if (!existing) return undefined
  const { createdAt, updatedAt, ...activity } = existing
  void createdAt
  void updatedAt
  return upsertActivity(activities, {
    ...activity,
    detail: finalResponse,
    serverDetail: finalResponse,
    title: "Agent response",
    messageKind: "final",
    status: "completed" as const,
  })
}

function finalResponseMessageActivity(
  activities: UserStoryAgentActivity[],
  finalResponse: string
) {
  const lastActivity = activities.at(-1)
  if (lastActivity?.kind !== "message") return undefined
  if (!sameStreamingResponse(lastActivity.detail, finalResponse)) {
    return undefined
  }
  return lastActivity
}

function sameStreamingResponse(left: string, right: string) {
  const normalizedLeft = normalizedStreamedMessage(left)
  const normalizedRight = normalizedStreamedMessage(right)
  if (!normalizedLeft) return false
  return (
    normalizedLeft === normalizedRight ||
    normalizedRight.startsWith(normalizedLeft) ||
    sameLeadingStreamedMessage(normalizedLeft, normalizedRight)
  )
}

function sameLeadingStreamedMessage(left: string, right: string) {
  const prefixLength = Math.min(left.length, right.length, 80)
  if (prefixLength < 40) return false
  return left.slice(0, prefixLength) === right.slice(0, prefixLength)
}

function normalizedStreamedMessage(value: string) {
  return normalizedStreamedMessageLineEndings(value).trim()
}

function normalizedStreamedMessageLineEndings(value: string) {
  return value.replace(/\r\n?/g, "\n")
}

function toolActivities(
  activities: UserStoryAgentActivity[],
  event: AgentEvent
) {
  const payload = eventPayload(event)
  const phase = stringValue(payload.phase) ?? stringValue(payload.hookEventName)
  const input = toolActivityInput(activities, payload, phase)
  const message = spawnAgentMessageActivityInput(input, payload)
  return upsertActivities(activities, [
    ...closeRunningActivityInputs(activities, ["message", "reasoning"]),
    ...toolActivityInputs(activities, phase, input),
    ...(message ? [message] : []),
  ])
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
  const existingDetail = parseDetailRecord(existing?.detail)
  const agent =
    toolName === "spawn_agent"
      ? spawnAgentInfo(recordValue(toolCall.input), existing)
      : undefined
  return {
    id,
    kind: "tool",
    title: toolTitle(toolName, phase),
    detail: toolDetail(payload, true, existingDetail),
    serverDetail: toolDetail(payload, false, existingDetail),
    status: toolStatus(phase),
    iteration,
    parallelGroupId: existing?.parallelGroupId,
    toolCallId,
    toolName,
    ...(agent ? { agentName: agent.name } : {}),
    ...(agent?.avatar ? { agentAvatar: agent.avatar } : {}),
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
  return lastMatchingActivity(
    activities,
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
    status: "running" as const,
  })
}

function eventFinalResponse(
  activities: UserStoryAgentActivity[],
  event: AgentEvent
) {
  if (!completedAgentRun(event)) return undefined
  const payload = eventPayload(event)
  const text = stringValue(payload.text)
  return text?.trim() || lastMessageResponse(activities)
}

function lastMessageResponse(activities: UserStoryAgentActivity[]) {
  const lastActivity = activities.at(-1)
  if (lastActivity?.kind !== "message") return undefined
  return lastActivity.detail.trim() || undefined
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

function spawnAgentMessageActivityInput(
  toolInput: ActivityInput,
  payload: Record<string, unknown>
): ActivityInput | undefined {
  if (toolInput.toolName !== "spawn_agent") return undefined
  if (toolInput.status !== "completed") return undefined
  const text = spawnAgentResponseText(payload.output)
  if (!text) return undefined
  const agent =
    spawnAgentInfo(recordValue(recordValue(payload.toolCall).input), toolInput) ??
    spawnAgentInfoFromResponse(text) ??
    fallbackSpawnAgentInfo
  return {
    id: `spawn-agent-response-${toolInput.id}`,
    kind: "message",
    title: agent.name,
    detail: text,
    serverDetail: text,
    status: "completed",
    messageKind: "intermediate",
    iteration: toolInput.iteration,
    agentName: agent.name,
    ...(agent.avatar ? { agentAvatar: agent.avatar } : {}),
  }
}

function spawnAgentResponseText(output: unknown) {
  const outputRecord = recordValue(output)
  const text = stringValue(outputRecord.text)?.trim()
  if (text) return text
  return stringValue(output)?.trim()
}

function spawnAgentInfoFromResponse(response: string) {
  return specialistAgents.find((agent) =>
    agent.responseMatches.some((match) => response.includes(match))
  )
}

function spawnAgentInfo(
  input: Record<string, unknown>,
  existing?: UserStoryAgentActivity
) {
  const systemPrompt = stringValue(input.systemPrompt) ?? ""
  const matchedAgent = specialistAgents.find((agent) =>
    systemPrompt.includes(agent.promptMatch)
  )
  if (matchedAgent) return matchedAgent
  if (!existing?.agentName) return undefined
  return {
    name: existing.agentName,
    ...(existing.agentAvatar ? { avatar: existing.agentAvatar } : {}),
    promptMatch: "",
    responseMatches: [],
  }
}

const fallbackSpawnAgentInfo = {
  name: "Agent",
  responseMatches: [],
}

const specialistAgents = [
  {
    name: "Codebase Analyst",
    avatar: publicAssetUrl("agents/codebase-analyst.png"),
    promptMatch: "Blame's Codebase Analyst",
    responseMatches: ["## Codebase Analysis"],
  },
  {
    name: "Frontend Design Specialist",
    avatar: publicAssetUrl("agents/frontend-design-specialist.png"),
    promptMatch: "Blame's Frontend Design Specialist",
    responseMatches: ["## Frontend Design Review"],
  },
  {
    name: "Risk & Review Analyst",
    avatar: publicAssetUrl("agents/risk-review-analyst.png"),
    promptMatch: "Blame's Risk & Review Analyst",
    responseMatches: ["## Risk Review"],
  },
  {
    name: "Story Analyst",
    avatar: publicAssetUrl("agents/story-analyst.png"),
    promptMatch: "Blame's Story Analyst",
    responseMatches: ["## Story Analysis"],
  },
  {
    name: "Test & Verification Analyst",
    avatar: publicAssetUrl("agents/test-verification-analyst.png"),
    promptMatch: "Blame's Test & Verification Analyst",
    responseMatches: ["## Verification Plan"],
  },
] as const

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

function toolStatus(phase: string | undefined): ActivityStatus {
  if (phase === "finished" || phase === "tool_result") return "completed"
  if (phase === "agent_error") return "failed"
  return "running"
}

function toolDetail(
  payload: Record<string, unknown>,
  compact: boolean,
  existing: Record<string, unknown>
) {
  const toolCall = recordValue(payload.toolCall)
  const detail = {
    durationMs: payload.durationMs ?? existing.durationMs,
    toolName:
      stringValue(toolCall.name) ??
      stringValue(toolCall.toolName) ??
      existing.toolName,
    input:
      toolCall.input === undefined
        ? existing.input
        : compact
          ? compactValue(toolCall.input)
          : toolCall.input,
    output:
      payload.output === undefined
        ? existing.output
        : compact
          ? compactValue(payload.output)
          : payload.output,
    update:
      payload.update === undefined
        ? existing.update
        : compact
          ? compactValue(payload.update)
          : payload.update,
    hookEventName: payload.hookEventName ?? existing.hookEventName,
  }
  return stringifyDetail(
    detail,
    compact ? maxActivityDetailLength : maxServerActivityDetailLength
  )
}

function parseDetailRecord(value: string | undefined) {
  if (!value) return {}
  try {
    return recordValue(JSON.parse(value))
  } catch {
    return {}
  }
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
  return [
    "aborted",
    "cancelled",
    "canceled",
    "error",
    "failed",
    "max-iterations",
    "max_iterations",
    "mistake-limit",
    "mistake_limit",
  ].includes(normalizedDoneReason(reason))
}

function completedDoneReason(reason: string) {
  return ["complete", "completed", "done", "success", "succeeded"].includes(
    normalizedDoneReason(reason)
  )
}

function doneReason(payload: Record<string, unknown>) {
  return (
    stringValue(payload.status) ??
    stringValue(payload.reason) ??
    stringValue(payload.finishReason)
  )
}

function normalizedDoneReason(reason: string) {
  return reason.trim().toLowerCase()
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

function eventUsage(
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
    headroomCompressionCount:
      numberValue(usage.headroomCompressionCount) ??
      current.headroomCompressionCount,
    headroomCompressionRatio:
      numberValue(usage.headroomCompressionRatio) ??
      current.headroomCompressionRatio,
    headroomLastTokensSaved:
      numberValue(usage.headroomLastTokensSaved) ??
      current.headroomLastTokensSaved,
    headroomTokensAfter:
      numberValue(usage.headroomTokensAfter) ?? current.headroomTokensAfter,
    headroomTokensBefore:
      numberValue(usage.headroomTokensBefore) ?? current.headroomTokensBefore,
    headroomTokensSaved:
      numberValue(usage.headroomTokensSaved) ?? current.headroomTokensSaved,
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
    current.headroomCompressionCount !== next.headroomCompressionCount ||
    current.headroomCompressionRatio !== next.headroomCompressionRatio ||
    current.headroomLastTokensSaved !== next.headroomLastTokensSaved ||
    current.headroomTokensAfter !== next.headroomTokensAfter ||
    current.headroomTokensBefore !== next.headroomTokensBefore ||
    current.headroomTokensSaved !== next.headroomTokensSaved ||
    current.inputTokens !== next.inputTokens ||
    current.outputTokens !== next.outputTokens ||
    current.totalCacheReadTokens !== next.totalCacheReadTokens ||
    current.totalCacheWriteTokens !== next.totalCacheWriteTokens ||
    current.totalCost !== next.totalCost ||
    current.totalInputTokens !== next.totalInputTokens ||
    current.totalOutputTokens !== next.totalOutputTokens
  )
}

function eventSessionSummary(story: AgentFlowState, event: AgentEvent) {
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

function usageWithDefaults(
  usage: UserStoryAgentUsage | null | undefined
): UserStoryAgentUsage {
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
