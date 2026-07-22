import type { AgentEvent } from "@blame/agent-runtime"

const defaultDelayMs = 50

export function createAgentEventCoalescer(
  callback: (event: AgentEvent) => void,
  delayMs = defaultDelayMs
) {
  let pending: AgentEvent | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    if (!pending) return
    const event = pending
    pending = undefined
    callback(event)
  }

  return {
    push(event: AgentEvent) {
      if (!coalescibleAgentEvent(event)) {
        flush()
        callback(event)
        return
      }
      if (pending && !mergeableAgentEvents(pending, event)) flush()
      pending = pending ? mergeAgentEvents(pending, event) : event
      timer ??= setTimeout(flush, delayMs)
    },
    close() {
      flush()
    },
  }
}

function mergeableAgentEvents(current: AgentEvent, next: AgentEvent) {
  const currentPayload = recordValue(current.payload)
  const nextPayload = recordValue(next.payload)
  return (
    current.type === next.type &&
    current.sessionId === next.sessionId &&
    currentPayload.iteration === nextPayload.iteration
  )
}

function coalescibleAgentEvent(event: AgentEvent) {
  return event.type === "text" || event.type === "reasoning"
}

function mergeAgentEvents(current: AgentEvent, next: AgentEvent) {
  const currentPayload = recordValue(current.payload)
  const nextPayload = recordValue(next.payload)
  if (currentPayload.iteration !== nextPayload.iteration) return next
  const accumulatedText = stringValue(nextPayload.accumulatedText)
  const currentText =
    stringValue(currentPayload.accumulatedText) ?? stringValue(currentPayload.text) ?? ""
  const nextText = stringValue(nextPayload.text) ?? ""
  return {
    ...next,
    payload: {
      ...nextPayload,
      text: accumulatedText
        ? undefined
        : appendStreamingText(currentText, nextText),
      ...(accumulatedText ? { accumulatedText } : {}),
    },
  }
}

function appendStreamingText(current: string, next: string) {
  if (!current || next.startsWith(current)) return next || current
  return `${current}${next}`
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}