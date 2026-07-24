import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
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

  test('serves an executable passkey script', async ({ client, assert }) => {
    const response = await client.get('/api/v1/auth/desktop')

    response.assertStatus(200)
    const script = response.text().match(/<script>([\s\S]*?)<\/script>/)?.[1]
    assert.isString(script)
    assert.doesNotThrow(() => Function(script!))
  })
})

test.group('auth', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => testUtils.db().truncate())

  test('accepts Better Auth bearer tokens on protected routes', async ({ client, assert }) => {
    const email = `${crypto.randomUUID()}@example.com`
    const password = 'password123!'
    await client.post('/api/v1/auth/sign-up/email').json({
      email,
      name: 'Ada Lovelace',
      password,
    })
    const user = await User.findByOrFail('email', email)
    user.emailVerified = true
    await user.save()
    await db.from('users').where('id', user.id).update({ two_factor_enabled: false })

    const signIn = await client.post('/api/v1/auth/sign-in/email').json({ email, password })
    signIn.assertStatus(200)
    const token = signIn.header('set-auth-token')
    assert.isString(token)

    const profile = await client
      .get('/api/v1/account/profile')
      .header('Authorization', `Bearer ${token}`)

    profile.assertStatus(200)
  })

  test('requires an email OTP after a valid password', async ({ client, assert }) => {
    const email = `${crypto.randomUUID()}@example.com`
    const password = 'password123!'
    await client.post('/api/v1/auth/sign-up/email').json({
      email,
      name: 'Ada Lovelace',
      password,
    })
    const user = await User.findByOrFail('email', email)
    user.emailVerified = true
    await user.save()

    const signIn = await client.post('/api/v1/auth/sign-in/email').json({ email, password })

    signIn.assertStatus(200)
    assert.isTrue(signIn.body().twoFactorRedirect)
    assert.deepEqual(signIn.body().twoFactorMethods, ['otp'])
    assert.isUndefined(signIn.header('set-auth-token'))
  })

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
