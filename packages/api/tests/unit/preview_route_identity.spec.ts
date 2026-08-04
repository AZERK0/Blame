import { opaqueRouteId } from '#services/preview_gateway/preview_edge_route_service'
import { test } from '@japa/runner'

test.group('preview route identity', () => {
  test('scopes repeated endpoint ids by session and service', ({ assert }) => {
    const api = opaqueRouteId('session-1', 'api', 'http')
    const app = opaqueRouteId('session-1', 'app', 'http')
    const vitrine = opaqueRouteId('session-1', 'vitrine', 'http')

    assert.notEqual(api, app)
    assert.notEqual(app, vitrine)
    assert.equal(api, opaqueRouteId('session-1', 'api', 'http'))
    assert.notEqual(api, opaqueRouteId('session-2', 'api', 'http'))
  })
})
