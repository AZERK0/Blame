import TelemetryTokenService from '#services/telemetry_token_service'
import { test } from '@japa/runner'

const secret = 'test-telemetry-secret-longer-than-thirty-two-characters'

test.group('telemetry token', () => {
  test('issues scoped short-lived tokens', ({ assert }) => {
    const now = Date.parse('2026-07-14T10:00:00.000Z')
    const service = new TelemetryTokenService({ now: () => now, secret, ttlSeconds: 900 })
    const session = service.issue('user-1')
    const claims = service.verify(session.token)

    assert.equal(claims?.sub, 'user-1')
    assert.equal(claims?.scope, 'telemetry:write')
    assert.equal(session.expiresAt, '2026-07-14T10:15:00.000Z')
  })

  test('rejects tampered and expired tokens', ({ assert }) => {
    let now = Date.parse('2026-07-14T10:00:00.000Z')
    const service = new TelemetryTokenService({ now: () => now, secret, ttlSeconds: 900 })
    const session = service.issue('user-1')
    const tampered = `${session.token.slice(0, -1)}x`

    assert.isNull(service.verify(tampered))
    now += 901_000
    assert.isNull(service.verify(session.token))
  })
})
