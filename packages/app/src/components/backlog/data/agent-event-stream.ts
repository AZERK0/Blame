import type { AgentEvent } from "@blame/agent-runtime"

import type { Platform } from "@/context/platform"
import { recordPerformanceCount } from "@/lib/performance-diagnostics"
import { createAgentEventCoalescer } from "./agent-event-coalescer"

export function subscribeAgentEvents(
  platform: Platform,
  sessionId: string,
  callback: (event: AgentEvent) => void
) {
  let closed = false
  let fallback: (() => void) | undefined
  let source: EventSource | undefined
  const coalescer = createAgentEventCoalescer((event) => {
    recordPerformanceCount(`agent.event.delivered.${event.type}`)
    callback(event)
  })
  const handleEvent = (event: AgentEvent) => {
    recordPerformanceCount(`agent.event.received.${event.type}`)
    coalescer.push(event)
  }

  void platform.agent?.sessions
    .eventStreamUrl?.(sessionId)
    .then((url) => {
      if (closed) return
      if (!url) {
        fallback = subscribeIpcAgentEvents(platform, sessionId, handleEvent)
        return
      }
      source = createAgentEventSource(url, handleEvent)
    })
    .catch(() => {
      if (!closed) fallback = subscribeIpcAgentEvents(platform, sessionId, handleEvent)
    })

  return () => {
    closed = true
    source?.close()
    fallback?.()
    coalescer.close()
  }
}

function createAgentEventSource(
  url: string,
  callback: (event: AgentEvent) => void
) {
  const source = new EventSource(url)
  source.onmessage = (message) => {
    try {
      callback(JSON.parse(message.data))
    } catch {}
  }
  return source
}

function subscribeIpcAgentEvents(
  platform: Platform,
  sessionId: string,
  callback: (event: AgentEvent) => void
) {
  return platform.agent?.sessions.onEvent(sessionId, callback) ?? noop
}

function noop() {}
