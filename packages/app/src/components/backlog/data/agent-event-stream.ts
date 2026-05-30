import type { AgentEvent } from "@blame/agent-runtime"

import type { Platform } from "@/context/platform"

export function subscribeAgentEvents(
  platform: Platform,
  sessionId: string,
  callback: (event: AgentEvent) => void
) {
  let closed = false
  let fallback: (() => void) | undefined
  let source: EventSource | undefined

  void platform.agent?.sessions
    .eventStreamUrl?.(sessionId)
    .then((url) => {
      if (closed) return
      if (!url) {
        fallback = subscribeIpcAgentEvents(platform, sessionId, callback)
        return
      }
      source = createAgentEventSource(url, callback, () => {
        if (closed || fallback) return
        source?.close()
        fallback = subscribeIpcAgentEvents(platform, sessionId, callback)
      })
    })
    .catch(() => {
      if (!closed) fallback = subscribeIpcAgentEvents(platform, sessionId, callback)
    })

  return () => {
    closed = true
    source?.close()
    fallback?.()
  }
}

function createAgentEventSource(
  url: string,
  callback: (event: AgentEvent) => void,
  fallback: () => void
) {
  const source = new EventSource(url)
  source.onmessage = (message) => callback(JSON.parse(message.data))
  source.onerror = fallback
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
