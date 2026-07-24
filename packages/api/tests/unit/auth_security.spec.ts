import { test } from '@japa/runner'
import { readFile } from 'node:fs/promises'

test.group('auth security configuration', () => {
  test('requires signed bearer tokens and verified local accounts for implicit linking', async ({
    assert,
  }) => {
    const source = await readFile(new URL('../../app/lib/better_auth.ts', import.meta.url), 'utf8')

    assert.include(source, 'bearer({ requireSignature: true })')
    assert.include(source, "trustedProviders: ['google', 'github']")
    assert.include(source, 'requireLocalEmailVerified: true')
    assert.include(source, 'allowDifferentEmails: false')
  })

  test('enforces modern password and reset-session rules', async ({ assert }) => {
    const source = await readFile(new URL('../../app/lib/better_auth.ts', import.meta.url), 'utf8')

    assert.include(source, 'minPasswordLength: 12')
    assert.include(source, 'maxPasswordLength: 128')
    assert.include(source, 'revokeSessionsOnPasswordReset: true')
    assert.include(source, 'requireEmailVerification: true')
  })

  test('requires a hashed email OTP after password authentication', async ({ assert }) => {
    const source = await readFile(new URL('../../app/lib/better_auth.ts', import.meta.url), 'utf8')

    assert.include(source, "twoFactorTable: 'auth_two_factors'")
    assert.include(source, "storeOTP: 'hashed'")
    assert.include(source, "twoFactorEnabled: 'two_factor_enabled'")
    assert.include(source, 'Your Blame sign-in code is ${otp}')
  })

  test('never puts a reusable session token in the desktop deep link', async ({ assert }) => {
    const source = await readFile(
      new URL('../../app/controllers/desktop_auth_controller.ts', import.meta.url),
      'utf8'
    )

    assert.include(source, 'blame://auth/callback?code=')
    assert.include(source, "createHash('sha256')")
    assert.notMatch(source, /blame:\/\/auth\/callback\?token=/)
  })
})
