import TelemetryUpstreamHealthService from '#services/telemetry_upstream_health_service'
import { test } from '@japa/runner'

test.group('telemetry upstream health', () => {
  test('opens a bounded exponential circuit and resets after success', ({ assert }) => {
    let now = Date.parse('2026-08-25T10:00:00.000Z')
    const service = new TelemetryUpstreamHealthService(() => now)

    assert.isTrue(service.canAttempt())
    assert.equal(service.recordFailure().retryAfterSeconds, 5)
    assert.isFalse(service.canAttempt())
    now += 5_000
    assert.isTrue(service.canAttempt())
    assert.equal(service.recordFailure().retryAfterSeconds, 30)
    assert.equal(service.snapshot().circuit, 'open')
    service.recordSuccess()
    assert.deepEqual(service.snapshot(), {
      available: true,
      circuit: 'closed',
      retryAfterSeconds: 0,
      consecutiveFailures: 0,
      suppressedFailures: 0,
    })
  })
})
