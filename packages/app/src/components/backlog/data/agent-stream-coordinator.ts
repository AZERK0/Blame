import type { AgentEvent } from "@blame/agent-runtime"
import type { AgentPersistenceEvent } from "./backlog-data.ts"

import {
  agentFlowUpdate,
  terminalAgentRunEvent,
  type AgentFlowState,
  type AgentFlowUpdate,
} from "./agent-flow.ts"
import {
  agentStreamStore,
  type AgentStreamIdentity,
  type AgentStreamStore,
} from "./agent-stream-store.ts"

export type AgentStreamSnapshotPersistence = {
  event: AgentEvent
  persistenceEvent: AgentPersistenceEvent
  update: AgentFlowUpdate
}

type AgentStreamCoordinatorInput = AgentStreamIdentity & {
  executionId: string
  initialState: AgentFlowState
  onError?: (error: unknown) => void
  persist(snapshot: AgentStreamSnapshotPersistence): Promise<unknown> | unknown
  store?: AgentStreamStore
}

type PendingSnapshot = AgentStreamSnapshotPersistence & {
  activityId?: string
  bytes: number
}

type AgentPersistenceIdentity = {
  executionId: string
  lastSequenceNumber?: number | null
  runId: string
  sessionId: string
}

const snapshotIntervalMs = 750
const snapshotByteThreshold = 3 * 1024

export class AgentStreamCoordinator {
  private readonly input: AgentStreamCoordinatorInput
  private state: AgentFlowState
  private pending?: PendingSnapshot
  private timer?: ReturnType<typeof setTimeout>
  private persistence = Promise.resolve<unknown>(undefined)
  private sequenceNumber = 0
  private readonly identity: AgentStreamIdentity
  private readonly store: AgentStreamStore

  constructor(input: AgentStreamCoordinatorInput) {
    this.input = input
    this.identity = { runId: input.runId, sessionId: input.sessionId }
    this.state = input.initialState
    this.store = input.store ?? agentStreamStore
  }

  push(event: AgentEvent) {
    const persistentEvent = this.persistentEvent(event)
    const update = agentFlowUpdate(this.state, persistentEvent.event)
    this.state = applyFlowUpdate(this.state, update)
    const activity = update.agentActivity
    const snapshot = { ...persistentEvent, update }
    if (streamingEvent(persistentEvent.event) && activity) {
      this.publishActivity(activity)
      return this.queueSnapshot(snapshot, activity.id)
    }
    this.store.flush(this.identity)
    const previous = this.flushPending()
    const persisted = this.enqueue(snapshot, previous)
    if (!terminalAgentRunEvent(persistentEvent.event)) return persisted
    return persisted.finally(() => this.store.clear(this.identity))
  }

  flush() {
    this.store.flush(this.identity)
    return this.flushPending()
  }

  close() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    return this.flush().finally(() => this.store.clear(this.identity))
  }

  private publishActivity(
    activity: NonNullable<AgentFlowUpdate["agentActivity"]>
  ) {
    if (activity.kind === "message") this.store.publish(this.identity, activity)
  }

  private queueSnapshot(
    snapshot: AgentStreamSnapshotPersistence,
    activityId: string
  ) {
    if (this.pending && this.pending.activityId !== activityId)
      this.flushPending()
    const bytes = this.pending?.bytes ?? 0
    this.pending = {
      ...snapshot,
      activityId,
      bytes: bytes + eventTextBytes(snapshot.event),
    }
    if (this.pending.bytes >= snapshotByteThreshold) return this.flushPending()
    this.timer ??= setTimeout(() => {
      this.timer = undefined
      void this.flushPending().catch(this.input.onError)
    }, snapshotIntervalMs)
    return Promise.resolve(undefined)
  }

  private flushPending() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    const pending = this.pending
    this.pending = undefined
    if (!pending) return this.persistence
    const { activityId, bytes, ...snapshot } = pending
    void activityId
    void bytes
    return this.enqueue(snapshot, this.persistence)
  }

  private enqueue(
    snapshot: AgentStreamSnapshotPersistence,
    after: Promise<unknown>
  ) {
    const persistence = after
      .catch(() => undefined)
      .then(() => this.input.persist(snapshot))
    this.persistence = persistence
    return persistence
  }

  private persistentEvent(event: AgentEvent) {
    const persistenceEvent = agentPersistenceEvent(event, {
      executionId: this.input.executionId,
      lastSequenceNumber: this.sequenceNumber,
      ...this.identity,
    })
    this.sequenceNumber = persistenceEvent.sequenceNumber
    const normalized = {
      ...event,
      ...persistenceEvent,
    }
    return {
      event: normalized,
      persistenceEvent,
    }
  }
}

export function agentPersistenceEvent(
  event: AgentEvent,
  identity: AgentPersistenceIdentity
): AgentPersistenceEvent {
  return {
    createdAt: event.createdAt ?? new Date().toISOString(),
    eventId: event.eventId ?? randomEventId(),
    eventType: event.eventType ?? event.type,
    executionId: event.executionId ?? identity.executionId,
    runId: identity.runId,
    sequenceNumber: Math.max(
      (identity.lastSequenceNumber ?? 0) + 1,
      event.sequenceNumber ?? 0
    ),
    sessionId: event.sessionId ?? identity.sessionId,
  }
}

function applyFlowUpdate(state: AgentFlowState, update: AgentFlowUpdate) {
  return {
    ...state,
    ...(update.agentActivities !== undefined
      ? { agentActivities: fullDetailActivities(update) }
      : {}),
    ...(update.agentFinalResponse !== undefined
      ? { agentFinalResponse: update.agentFinalResponse }
      : {}),
    ...(update.agentSessionSummary !== undefined
      ? { agentSessionSummary: update.agentSessionSummary }
      : {}),
    ...(update.agentUsage !== undefined
      ? { agentUsage: update.agentUsage }
      : {}),
  }
}

function fullDetailActivities(update: AgentFlowUpdate) {
  const activities = update.agentActivities ?? []
  const activity = update.agentActivity
  if (!activity) return activities
  return activities.map((candidate) =>
    candidate.id === activity.id ? activity : candidate
  )
}

function streamingEvent(event: AgentEvent) {
  return event.type === "text" || event.type === "reasoning"
}

function eventTextBytes(event: AgentEvent) {
  const payload = event.payload
  if (!payload || typeof payload !== "object") return 0
  const record = payload as Record<string, unknown>
  const value = record.text ?? record.reasoning ?? record.accumulatedText ?? ""
  if (typeof value !== "string") return 0
  return new TextEncoder().encode(value).byteLength
}

function randomEventId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
}
