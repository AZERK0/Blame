import type { UserStoryAgentActivity } from "./backlog-data.ts"

export type AgentStreamIdentity = {
  runId: string
  sessionId: string
}

export type AgentStreamActivitySnapshot = {
  activity: UserStoryAgentActivity
  revision: number
  sequenceNumber: number
}

export type AgentStreamOrderSnapshot = {
  activityIds: string[]
  revision: number
}

type FrameScheduler = {
  cancel(frame: number): void
  request(callback: () => void): number
}

type PendingActivity = {
  activity: UserStoryAgentActivity
  sequenceNumber: number
}

type StreamEntry = {
  activities: Map<string, AgentStreamActivitySnapshot>
  activityListeners: Map<string, Set<() => void>>
  frame?: number
  orderListeners: Set<() => void>
  orderSnapshot: AgentStreamOrderSnapshot
  pending: Map<string, PendingActivity>
}

export class AgentStreamStore {
  private readonly entries = new Map<string, StreamEntry>()
  private activityRenderCount = 0
  private orderRenderCount = 0
  private readonly scheduler: FrameScheduler

  constructor(scheduler: FrameScheduler = browserFrameScheduler()) {
    this.scheduler = scheduler
  }

  publish(
    identity: AgentStreamIdentity,
    activities: UserStoryAgentActivity[],
    sequenceNumber: number
  ) {
    const entry = this.entry(identity)
    activities.forEach((activity) =>
      queueActivity(entry, activity, sequenceNumber)
    )
    if (!entry.pending.size || entry.frame !== undefined) return
    entry.frame = this.scheduler.request(() => this.paint(entry))
  }

  seed(
    identity: AgentStreamIdentity,
    activities: UserStoryAgentActivity[],
    sequenceNumber: number
  ) {
    const entry = this.entry(identity)
    const updates = activities.filter((activity) =>
      newerThanStored(entry, activity.id, sequenceNumber)
    )
    this.commit(
      entry,
      updates.map((activity) => ({ activity, sequenceNumber }))
    )
  }

  flush(identity: AgentStreamIdentity) {
    const entry = this.entries.get(streamIdentityKey(identity))
    if (!entry?.pending.size) return
    if (entry.frame !== undefined) this.scheduler.cancel(entry.frame)
    this.paint(entry)
  }

  clear(identity: AgentStreamIdentity) {
    const key = streamIdentityKey(identity)
    const entry = this.entries.get(key)
    if (!entry) return
    if (entry.frame !== undefined) this.scheduler.cancel(entry.frame)
    const activityIds = [...entry.activities.keys()]
    entry.frame = undefined
    entry.pending.clear()
    entry.activities.clear()
    setOrder(entry, [])
    activityIds.forEach((id) => notifyActivity(entry, id))
    if (!hasListeners(entry)) this.entries.delete(key)
  }

  subscribeOrder(identity: AgentStreamIdentity, listener: () => void) {
    const entry = this.entry(identity)
    entry.orderListeners.add(listener)
    return () => {
      entry.orderListeners.delete(listener)
      this.deleteUnusedEntry(identity, entry)
    }
  }

  subscribeActivity(
    identity: AgentStreamIdentity,
    activityId: string,
    listener: () => void
  ) {
    const entry = this.entry(identity)
    const listeners = entry.activityListeners.get(activityId) ?? new Set()
    listeners.add(listener)
    entry.activityListeners.set(activityId, listeners)
    return () => {
      listeners.delete(listener)
      if (!listeners.size) entry.activityListeners.delete(activityId)
      this.deleteUnusedEntry(identity, entry)
    }
  }

  orderSnapshot(identity: AgentStreamIdentity) {
    return this.entry(identity).orderSnapshot
  }

  activitySnapshot(identity: AgentStreamIdentity, activityId: string) {
    return this.entries
      .get(streamIdentityKey(identity))
      ?.activities.get(activityId)
  }

  renders() {
    return this.activityRenderCount
  }

  orderRenders() {
    return this.orderRenderCount
  }

  resetMetrics() {
    this.activityRenderCount = 0
    this.orderRenderCount = 0
  }

  private entry(identity: AgentStreamIdentity) {
    const key = streamIdentityKey(identity)
    const current = this.entries.get(key)
    if (current) return current
    const entry = createStreamEntry()
    this.entries.set(key, entry)
    return entry
  }

  private paint(entry: StreamEntry) {
    const pending = [...entry.pending.values()]
    entry.frame = undefined
    entry.pending.clear()
    this.commit(entry, pending)
  }

  private commit(entry: StreamEntry, updates: PendingActivity[]) {
    if (!updates.length) return
    const order = [...entry.orderSnapshot.activityIds]
    updates.forEach(({ activity, sequenceNumber }) => {
      const current = entry.activities.get(activity.id)
      if (!current) order.push(activity.id)
      entry.activities.set(activity.id, {
        activity,
        revision: (current?.revision ?? 0) + 1,
        sequenceNumber,
      })
      this.activityRenderCount += 1
      notifyActivity(entry, activity.id)
    })
    if (!sameOrder(order, entry.orderSnapshot.activityIds)) {
      setOrder(entry, order)
      this.orderRenderCount += 1
    }
  }

  private deleteUnusedEntry(identity: AgentStreamIdentity, entry: StreamEntry) {
    if (hasListeners(entry) || entry.activities.size || entry.pending.size)
      return
    this.entries.delete(streamIdentityKey(identity))
  }
}

export const agentStreamStore = new AgentStreamStore()

export function streamIdentityKey(identity: AgentStreamIdentity) {
  return JSON.stringify([identity.sessionId, identity.runId])
}

function createStreamEntry(): StreamEntry {
  return {
    activities: new Map(),
    activityListeners: new Map(),
    orderListeners: new Set(),
    orderSnapshot: { activityIds: [], revision: 0 },
    pending: new Map(),
  }
}

function queueActivity(
  entry: StreamEntry,
  activity: UserStoryAgentActivity,
  sequenceNumber: number
) {
  const pending = entry.pending.get(activity.id)
  const current = entry.activities.get(activity.id)
  const latestSequence = Math.max(
    pending?.sequenceNumber ?? 0,
    current?.sequenceNumber ?? 0
  )
  if (sequenceNumber < latestSequence) return
  entry.pending.set(activity.id, { activity, sequenceNumber })
}

function newerThanStored(
  entry: StreamEntry,
  activityId: string,
  sequenceNumber: number
) {
  const current = entry.activities.get(activityId)
  const pending = entry.pending.get(activityId)
  return (
    sequenceNumber > (current?.sequenceNumber ?? -1) &&
    sequenceNumber > (pending?.sequenceNumber ?? -1)
  )
}

function notifyActivity(entry: StreamEntry, activityId: string) {
  entry.activityListeners.get(activityId)?.forEach((listener) => listener())
}

function setOrder(entry: StreamEntry, activityIds: string[]) {
  entry.orderSnapshot = {
    activityIds,
    revision: entry.orderSnapshot.revision + 1,
  }
  entry.orderListeners.forEach((listener) => listener())
}

function sameOrder(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((activityId, index) => activityId === right[index])
  )
}

function hasListeners(entry: StreamEntry) {
  return Boolean(entry.orderListeners.size || entry.activityListeners.size)
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
