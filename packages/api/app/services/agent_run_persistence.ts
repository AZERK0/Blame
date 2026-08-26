import { Exception } from '@adonisjs/core/exceptions'
import { DateTime } from 'luxon'

export type AgentPersistenceInput = {
  createdAt: string
  eventId: string
  eventType: string
  executionId: string
  runId: string
  sequenceNumber: number
  sessionId: string
}

type PersistentAgentRun = {
  clineSessionId: string | null
  executionId: string | null
  id: string
  lastSequenceNumber: number
}

export function agentRunPersistenceUpdate(
  run: PersistentAgentRun,
  event: AgentPersistenceInput | undefined
) {
  if (!event) return {}
  assertAgentEventIdentity(run, event)
  if (event.sequenceNumber <= run.lastSequenceNumber) return undefined
  const createdAt = DateTime.fromISO(event.createdAt)
  if (!createdAt.isValid) throw invalidAgentEvent('Agent event creation time is invalid.')
  return {
    lastEventCreatedAt: createdAt,
    lastEventId: event.eventId,
    lastEventType: event.eventType,
    lastSequenceNumber: event.sequenceNumber,
  }
}

export function assertAgentRunStatusTransition(current: string, next: string | undefined) {
  if (!next || next === current) return
  const allowed =
    (current === 'pending' && next === 'running') ||
    (current === 'running' && terminalAgentStatus(next))
  if (!allowed) {
    throw new Exception('Agent run status transition is not monotonic.', {
      code: 'E_AGENT_RUN_STATUS_TRANSITION',
      status: 409,
    })
  }
}

export function terminalAgentStatus(status: string | undefined) {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function assertAgentEventIdentity(run: PersistentAgentRun, event: AgentPersistenceInput) {
  if (event.runId !== run.id) throw invalidAgentEvent('Agent event run does not match.')
  if (run.clineSessionId && event.sessionId !== run.clineSessionId) {
    throw invalidAgentEvent('Agent event session does not match.')
  }
  if (run.executionId && event.executionId !== run.executionId) {
    throw invalidAgentEvent('Agent event execution does not match.')
  }
}

function invalidAgentEvent(message: string) {
  return new Exception(message, {
    code: 'E_AGENT_EVENT_IDENTITY_MISMATCH',
    status: 409,
  })
}
