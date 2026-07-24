import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'

type SignupBody = {
  data: {
    user: {
      id: string
    }
    token: string
  }
}

const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

test.group('Better Auth response forwarding', () => {
  test('forwards empty redirects', async ({ client, assert }) => {
    const response = await client
      .get('/api/v1/auth/callback/google?error=access_denied')
      .redirects(0)

    response.assertStatus(302)
    assert.match(response.header('location') ?? '', /\/api\/v1\/auth\/error\?error=/)
    assert.equal(response.text(), '')
  })
})

test.group('auth', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => testUtils.db().truncate())

  test('creates users with uuid v7 ids', async ({ client, assert }) => {
    const response = await client.post('/api/v1/auth/signup').json({
      fullName: 'Ada Lovelace',
      email: `${crypto.randomUUID()}@example.com`,
      password: 'password123',
      passwordConfirmation: 'password123',
    })

    response.assertStatus(200)
    const body = response.body() as SignupBody
    assert.match(body.data.user.id, uuidV7Pattern)
    assert.isString(body.data.token)

    const user = await User.findOrFail(body.data.user.id)
    assert.equal(user.id, body.data.user.id)
  })
})
