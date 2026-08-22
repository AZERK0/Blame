import type { AgentEvent } from "@blame/agent-runtime"
import { createAgentEventCoalescer } from "@blame/agent-runtime/agent-event-coalescer"

import type { Platform } from "@/context/platform"
import { recordPerformanceCount } from "@/lib/performance-diagnostics"
import { agentEventMatchesExecution } from "./agent-run-lifecycle.ts"

type AgentEventSubscriptionState = {
  connections: number
  subscriptions: number
}

const rendererEventCoalescingDelayMs = 250
const activeSubscriptions = new Map<string, AgentEventSubscriptionState>()

export function activeAgentEventSubscription(sessionId: string | undefined) {
  return Boolean(
    sessionId && (activeSubscriptions.get(sessionId)?.connections ?? 0) > 0
  )
}

export function subscribeAgentEvents(
  platform: Platform,
  sessionId: string,
  callback: (event: AgentEvent) => void,
  executionId?: string
) {
  let closed = false
  let connected = false
  let fallback: (() => void) | undefined
  let source: EventSource | undefined
  const deliverEvent = (event: AgentEvent) => {
    recordPerformanceCount(`agent.event.delivered.${event.type}`)
    callback(event)
  }
  const coalescer = createAgentEventCoalescer(
    deliverEvent,
    rendererEventCoalescingDelayMs
  )
  const handleEvent = (event: AgentEvent) => {
    if (!agentEventMatchesExecution(event, executionId)) return
    recordPerformanceCount(`agent.event.received.${event.type}`)
    coalescer.push(event)
  }
  const updateConnection = (nextConnected: boolean) => {
    if (connected === nextConnected) return
    connected = nextConnected
    updateAgentEventConnection(sessionId, nextConnected ? 1 : -1)
  }
  registerAgentEventSubscription(sessionId)

  void platform.agent?.sessions
    .eventStreamUrl?.(sessionId)
    .then((url) => {
      if (closed) return
      if (!url) {
        fallback = subscribeIpcAgentEvents(platform, sessionId, handleEvent)
        updateConnection(Boolean(fallback))
        return
      }
      source = createAgentEventSource(
        url,
        handleEvent,
        () => updateConnection(true),
        () => updateConnection(false)
      )
    })
    .catch(() => {
      if (!closed) {
        fallback = subscribeIpcAgentEvents(platform, sessionId, handleEvent)
        updateConnection(Boolean(fallback))
      }
    })

  return () => {
    if (closed) return
    closed = true
    updateConnection(false)
    unregisterAgentEventSubscription(sessionId)
    source?.close()
    fallback?.()
    coalescer.close()
  }
}

function registerAgentEventSubscription(sessionId: string) {
  const current = activeSubscriptions.get(sessionId)
  activeSubscriptions.set(sessionId, {
    connections: current?.connections ?? 0,
    subscriptions: (current?.subscriptions ?? 0) + 1,
  })
}

function unregisterAgentEventSubscription(sessionId: string) {
  const current = activeSubscriptions.get(sessionId)
  if (!current || current.subscriptions <= 1) {
    activeSubscriptions.delete(sessionId)
    return
  }
  activeSubscriptions.set(sessionId, {
    ...current,
    subscriptions: current.subscriptions - 1,
  })
}

function updateAgentEventConnection(sessionId: string, delta: number) {
  const current = activeSubscriptions.get(sessionId)
  if (!current) return
  activeSubscriptions.set(sessionId, {
    ...current,
    connections: Math.max(0, current.connections + delta),
  })
}

function createAgentEventSource(
  url: string,
  callback: (event: AgentEvent) => void,
  onOpen: () => void,
  onError: () => void
) {
  const source = new EventSource(url)
  source.onopen = onOpen
  source.onerror = onError
  source.onmessage = (message) => {
    try {
      callback(JSON.parse(message.data))
    } catch {
      return
    }
  }
  return source
}

function subscribeIpcAgentEvents(
  platform: Platform,
  sessionId: string,
  callback: (event: AgentEvent) => void
) {
  return platform.agent?.sessions.onEvent(sessionId, callback)
}
