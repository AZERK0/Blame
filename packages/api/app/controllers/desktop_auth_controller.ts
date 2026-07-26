import { auth } from '#lib/better_auth'
import { sitePageUrl } from '#lib/site_url'
import { uuidV7 } from '#lib/uuid_v7'
import AccountClosureLedgerService from '#services/account_closure_ledger_service'
import User from '#models/user'
import UserTransformer from '#transformers/user_transformer'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { DateTime } from 'luxon'
import { fromNodeHeaders } from 'better-auth/node'

export default class DesktopAuthController {
  async passkey({ request, response }: HttpContext) {
    const userCode = stringInput(request.input('user_code'))
    return redirect(response, sitePageUrl('/auth/passkey', userCode ? { user_code: userCode } : {}))
  }

  async resetPassword({ request, response }: HttpContext) {
    const token = stringInput(request.input('token'))
    return redirect(response, sitePageUrl('/auth/reset-password', token ? { token } : {}))
  }

  verified({ response }: HttpContext) {
    return redirect(response, sitePageUrl('/auth/verify-email', { verified: 'true' }))
  }

  async complete({ request, response }: HttpContext) {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.request.headers) })
    if (!session) return response.redirect('blame://auth/callback?error=authentication_failed')
    const code = randomBytes(32).toString('base64url')
    await db.table('auth_desktop_handoffs').insert({
      id: uuidV7(),
      code_hash: codeHash(code),
      user_id: session.user.id,
      expires_at: DateTime.utc().plus({ minutes: 2 }).toSQL(),
      created_at: DateTime.utc().toSQL(),
    })
    return response.redirect(`blame://auth/callback?code=${encodeURIComponent(code)}`)
  }

  async exchange({ request, response, serialize }: HttpContext) {
    const code = typeof request.input('code') === 'string' ? request.input('code') : ''
    if (code.length < 32 || code.length > 128) {
      return response.unauthorized({ message: 'The sign-in request is invalid or expired.' })
    }
    const handoff = await db.transaction(async (transaction) => {
      const record = await transaction
        .from('auth_desktop_handoffs')
        .where('code_hash', codeHash(code))
        .forUpdate()
        .first()
      if (
        !record ||
        record.consumed_at ||
        DateTime.fromJSDate(record.expires_at) <= DateTime.utc()
      ) {
        return null
      }
      await transaction
        .from('auth_desktop_handoffs')
        .where('id', record.id)
        .update({ consumed_at: DateTime.utc().toSQL() })
      return record
    })
    if (!handoff || !safeHashMatch(handoff.code_hash, code)) {
      return response.unauthorized({ message: 'The sign-in request is invalid or expired.' })
    }
    return issueCloudSession(handoff.user_id, response, serialize)
  }

  async exchangeDeviceToken({ request, response, serialize }: HttpContext) {
    const token = typeof request.input('token') === 'string' ? request.input('token') : ''
    if (token.length < 20 || token.length > 512) {
      return response.unauthorized({ message: 'The sign-in request is invalid or expired.' })
    }
    const userId = await consumeDeviceSession(token)
    if (!userId) {
      return response.unauthorized({ message: 'The sign-in request is invalid or expired.' })
    }
    return issueCloudSession(userId, response, serialize)
  }
}

function stringInput(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function redirect(response: HttpContext['response'], url: string) {
  response.header('Location', url)
  return response.status(302).send(null)
}

async function consumeDeviceSession(token: string) {
  return db.transaction(async (transaction) => {
    const session = await transaction
      .from('auth_sessions')
      .where('token', token)
      .forUpdate()
      .first()
    if (!session || DateTime.fromJSDate(session.expires_at) <= DateTime.utc()) return null
    await transaction.from('auth_sessions').where('id', session.id).delete()
    return session.user_id as string
  })
}

async function issueCloudSession(
  userId: string,
  response: HttpContext['response'],
  serialize: HttpContext['serialize']
) {
  const user = await User.findOrFail(userId)
  const closureLedger = new AccountClosureLedgerService()
  if (user.closureRequestedAt || (await closureLedger.hasUser(user.id))) {
    return response.forbidden({
      message: 'This account is closed and no longer accepts sign-ins.',
    })
  }
  const token = await User.accessTokens.create(user)
  return serialize({ user: UserTransformer.transform(user), token: token.value!.release() })
}

function codeHash(code: string) {
  return createHash('sha256').update(code).digest('hex')
}

function safeHashMatch(expected: string, code: string) {
  const actual = codeHash(code)
  return (
    expected.length === actual.length && timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
  )
}
