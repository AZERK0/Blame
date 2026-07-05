import { uuidV7 } from '#lib/uuid_v7'
import { test } from '@japa/runner'

const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

test.group('uuid v7', () => {
  test('generates uuid v7 values', ({ assert }) => {
    assert.match(uuidV7(), uuidV7Pattern)
  })
})
