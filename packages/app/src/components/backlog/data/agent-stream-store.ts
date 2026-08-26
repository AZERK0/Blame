import type { UserStoryAgentActivity } from "./backlog-data.ts"

export type AgentStreamIdentity = {
  runId: string
  sessionId: string
}

export type AgentStreamSnapshot = {
  activity: UserStoryAgentActivity
  messageId: string
  revision: number
}

type FrameScheduler = {
  cancel(frame: number): void
  request(callback: () => void): number
}

type StreamEntry = {
  frame?: number
  listeners: Set<() => void>
  pending?: UserStoryAgentActivity
  snapshot?: AgentStreamSnapshot
}

export class AgentStreamStore {
  private readonly entries = new Map<string, StreamEntry>()
  private renderCount = 0
  private readonly scheduler: FrameScheduler

  constructor(scheduler: FrameScheduler = browserFrameScheduler()) {
    this.scheduler = scheduler
  }

  publish(identity: AgentStreamIdentity, activity: UserStoryAgentActivity) {
    const entry = this.entry(identity)
    entry.pending = activity
    if (entry.frame !== undefined) return
    entry.frame = this.scheduler.request(() => this.paint(entry))
  }

  flush(identity: AgentStreamIdentity) {
    const entry = this.entries.get(streamIdentityKey(identity))
    if (!entry?.pending) return
    if (entry.frame !== undefined) this.scheduler.cancel(entry.frame)
    this.paint(entry)
  }

  clear(identity: AgentStreamIdentity) {
    const key = streamIdentityKey(identity)
    const entry = this.entries.get(key)
    if (!entry) return
    if (entry.frame !== undefined) this.scheduler.cancel(entry.frame)
    entry.frame = undefined
    entry.pending = undefined
    entry.snapshot = undefined
    entry.listeners.forEach((listener) => listener())
    if (!entry.listeners.size) this.entries.delete(key)
  }

  subscribe(identity: AgentStreamIdentity, listener: () => void) {
    const entry = this.entry(identity)
    entry.listeners.add(listener)
    return () => {
      entry.listeners.delete(listener)
      if (!entry.listeners.size && !entry.snapshot && !entry.pending) {
        this.entries.delete(streamIdentityKey(identity))
      }
    }
  }

  snapshot(identity: AgentStreamIdentity) {
    return this.entries.get(streamIdentityKey(identity))?.snapshot
  }

  renders() {
    return this.renderCount
  }

  resetMetrics() {
    this.renderCount = 0
  }

  private entry(identity: AgentStreamIdentity) {
    const key = streamIdentityKey(identity)
    const current = this.entries.get(key)
    if (current) return current
    const entry: StreamEntry = { listeners: new Set() }
    this.entries.set(key, entry)
    return entry
  }

  private paint(entry: StreamEntry) {
    const activity = entry.pending
    entry.frame = undefined
    entry.pending = undefined
    if (!activity) return
    entry.snapshot = {
      activity,
      messageId: activity.id,
      revision: (entry.snapshot?.revision ?? 0) + 1,
    }
    this.renderCount += 1
    entry.listeners.forEach((listener) => listener())
  }
}

export const agentStreamStore = new AgentStreamStore()

export function streamIdentityKey(identity: AgentStreamIdentity) {
  return JSON.stringify([identity.sessionId, identity.runId])
}

function browserFrameScheduler(): FrameScheduler {
  return {
    cancel(frame) {
      if (typeof cancelAnimationFrame === "function")
        cancelAnimationFrame(frame)
      else clearTimeout(frame)
    },
    request(callback) {
      if (typeof requestAnimationFrame === "function") {
        return requestAnimationFrame(callback)
      }
      return setTimeout(callback, 16) as unknown as number
    },
  }
}
