export function completedClineLog(
  log: string,
  startedAt?: string,
  endedBefore?: string
) {
  const start = startedAt ? Date.parse(startedAt) : Number.NEGATIVE_INFINITY
  const end = endedBefore ? Date.parse(endedBefore) : Number.POSITIVE_INFINITY
  return log
    .split("\n")
    .some((line) => completedClineLogLine(line, start, end))
}

export function finalAssistantResponse(
  value: unknown,
  startedAt: string,
  endedBefore?: string
) {
  const messages = messageList(value)
  const start = Date.parse(startedAt)
  const end = endedBefore ? Date.parse(endedBefore) : Number.POSITIVE_INFINITY
  return messages
    .filter((message) => assistantMessageInRange(message, start, end))
    .map(messageText)
    .filter(Boolean)
    .at(-1)
}

function completedClineLogLine(line: string, start: number, end: number) {
  const entry = jsonRecord(line)
  const legacyEvent = stringValue(entry.message) === "event:done"
  const structuredEvent =
    stringValue(entry.event_name) === "blame.agent.event_done"
  if (!legacyEvent && !structuredEvent) return false
  if (!logEntryInRange(entry, start, end)) return false
  const payload = legacyEvent
    ? recordValue(entry.payload)
    : recordValue(entry.attributes)
  const reason =
    stringValue(payload.reason) ??
    stringValue(payload.finishReason) ??
    stringValue(payload.finish_reason) ??
    stringValue(payload.status)
  return !reason || !failedClineDoneReason(reason)
}

function logEntryInRange(
  entry: Record<string, unknown>,
  start: number,
  end: number
) {
  const timestamp = timestampValue(entry.timestamp ?? entry.ts)
  return timestamp === undefined || (timestamp >= start && timestamp < end)
}

function timestampValue(value: unknown) {
  if (typeof value === "number") return value
  if (typeof value !== "string") return undefined
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? undefined : timestamp
}

function messageList(value: unknown) {
  if (Array.isArray(value)) return value.map(recordValue)
  const messages = recordValue(value).messages
  return Array.isArray(messages) ? messages.map(recordValue) : []
}

function assistantMessageInRange(
  message: Record<string, unknown>,
  start: number,
  end: number
) {
  const timestamp = messageTimestamp(message)
  return message.role === "assistant" && timestamp >= start && timestamp < end
}

function messageTimestamp(message: Record<string, unknown>) {
  const value = message.ts ?? message.timestamp ?? message.createdAt
  if (typeof value === "number") return value
  if (typeof value === "string") return Date.parse(value)
  return Number.NaN
}

function messageText(message: Record<string, unknown>) {
  if (typeof message.content === "string") return message.content.trim()
  if (!Array.isArray(message.content)) return ""
  return message.content
    .map(recordValue)
    .filter((content) => content.type === "text")
    .map((content) => stringValue(content.text) ?? "")
    .join("\n")
    .trim()
}

function jsonRecord(value: string) {
  try {
    return recordValue(JSON.parse(value))
  } catch {
    return {}
  }
}

function recordValue(value: unknown) {
  if (value && typeof value === "object")
    return value as Record<string, unknown>
  return {}
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function failedClineDoneReason(reason: string) {
  return ["error", "aborted", "cancelled", "failed"].includes(
    reason.toLowerCase()
  )
}
