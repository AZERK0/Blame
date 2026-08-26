import {
  agentRunPersistenceUpdate,
  assertAgentRunStatusTransition,
} from '#services/agent_run_persistence'
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
