import type { AgentEvent } from "@blame/agent-runtime"

const maxActivityValueLength = 1400

export function parseDetailRecord(value: string | undefined) {
  if (!value) return {}
  try {
    return recordValue(JSON.parse(value))
  } catch {
    return {}
  }
}

export function eventPayload(event: AgentEvent) {
  if (event.payload && typeof event.payload === "object") {
    return event.payload as Record<string, unknown>
  }
  return {}
}

export function recordValue(value: unknown) {
  if (value && typeof value === "object")
    return value as Record<string, unknown>
  return {}
}

export function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

export function numberValue(value: unknown) {
  return typeof value === "number" ? value : undefined
}

export function truncate(value: string, length: number) {
  return value.length > length ? value.slice(0, length) : value
}

export function compactValue(value: unknown): unknown {
  if (value === undefined || value === null) return value
  if (typeof value === "string") return compactString(value)
  if (Array.isArray(value)) return compactArray(value)
  if (typeof value === "object") return compactRecord(value)
  return value
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

export function compactString(value: string) {
  if (value.length <= maxActivityValueLength) return value
  return {
    excerpt: truncateMiddle(value, maxActivityValueLength),
    originalLength: value.length,
    truncated: true,
  }
}

export function truncateMiddle(value: string, length: number) {
  if (value.length <= length) return value
  const edgeLength = Math.floor((length - 20) / 2)
  return `${value.slice(0, edgeLength)}\n...\n${value.slice(-edgeLength)}`
}
