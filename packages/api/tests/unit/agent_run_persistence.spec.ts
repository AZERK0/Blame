import {
  agentRunPersistenceUpdate,
  assertAgentRunStatusTransition,
} from '#services/agent_run_persistence'
import { terminalAgentRunActivities } from '#services/agent_run_activity_log'
import { test } from '@japa/runner'

test.group('agent run persistence', () => {
  test('confirms only a newer sequence for the matching run', ({ assert }) => {
    const run = persistentRun()
    const event = persistenceEvent(8)
    const update = agentRunPersistenceUpdate(run, event)

    assert.equal(update?.lastEventId, event.eventId)
    assert.equal(update?.lastEventType, event.eventType)
    assert.equal(update?.lastSequenceNumber, 8)
    assert.isUndefined(agentRunPersistenceUpdate({ ...run, lastSequenceNumber: 8 }, event))
  })

  test('rejects mismatched identities and regressive states', ({ assert }) => {
    assert.throws(
      () =>
        agentRunPersistenceUpdate(persistentRun(), {
          ...persistenceEvent(9),
          runId: crypto.randomUUID(),
        }),
      /run does not match/
    )
    assert.doesNotThrow(() => assertAgentRunStatusTransition('running', 'cancelled'))
    assert.throws(() => assertAgentRunStatusTransition('completed', 'running'), /not monotonic/)
  })

  test('closes every running activity at the terminal boundary', ({ assert }) => {
    const completedAt = '2026-08-31T10:00:00.000Z'
    const activities = terminalAgentRunActivities(
      [
        activity('reasoning-36-1', 'reasoning'),
        activity('tool-64', 'tool'),
        { ...activity('message-1', 'message'), status: 'completed' },
      ],
      completedAt
    )

    assert.deepEqual(
      activities.map(({ id, status, updatedAt }) => ({ id, status, updatedAt })),
      [
        { id: 'reasoning-36-1', status: 'completed', updatedAt: completedAt },
        { id: 'tool-64', status: 'failed', updatedAt: completedAt },
        { id: 'message-1', status: 'completed', updatedAt: undefined },
      ]
    )
  })
})

const runId = crypto.randomUUID()
const executionId = crypto.randomUUID()
const sessionId = crypto.randomUUID()

function persistentRun() {
  return {
    clineSessionId: sessionId,
    executionId,
    id: runId,
    lastSequenceNumber: 7,
  }
}

function persistenceEvent(sequenceNumber: number) {
  return {
    createdAt: new Date().toISOString(),
    eventId: `event-${sequenceNumber}`,
    eventType: 'text',
    executionId,
    runId,
    sequenceNumber,
    sessionId,
  }
}

function activity(id: string, kind: 'message' | 'reasoning' | 'tool') {
  return {
    createdAt: '2026-08-31T09:59:00.000Z',
    detail: id,
    id,
    kind,
    status: 'running' as const,
    title: id,
  }
}
