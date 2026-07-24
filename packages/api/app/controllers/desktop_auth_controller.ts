import { auth } from '#lib/better_auth'
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
  async passkey({ response }: HttpContext) {
    response.header('Content-Type', 'text/html; charset=utf-8')
    response.header(
      'Content-Security-Policy',
      "default-src 'none'; connect-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"
    )
    return response.send(passkeyPage())
  }

  async resetPassword({ request, response }: HttpContext) {
    const token = typeof request.input('token') === 'string' ? request.input('token') : ''
    response.header('Content-Type', 'text/html; charset=utf-8')
    response.header(
      'Content-Security-Policy',
      "default-src 'none'; connect-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"
    )
    return response.send(resetPasswordPage(token))
  }

  verified({ response }: HttpContext) {
    response.header('Content-Type', 'text/html; charset=utf-8')
    return response.send(
      authPage(
        'Email verified',
        'Your address is verified. Return to Blame and sign in.',
        '<a href="blame://auth/callback?error=email_verified">Return to Blame</a>'
      )
    )
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
    const user = await User.findOrFail(handoff.user_id)
    const closureLedger = new AccountClosureLedgerService()
    if (user.closureRequestedAt || (await closureLedger.hasUser(user.id))) {
      return response.forbidden({
        message: 'This account is closed and no longer accepts sign-ins.',
      })
    }
    const token = await User.accessTokens.create(user)
    return serialize({ user: UserTransformer.transform(user), token: token.value!.release() })
  }
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

export function passkeyPage() {
  return authPage(
    'Sign in with a passkey',
    'Use your device biometrics, PIN, or security key.',
    `
    <button id="continue">Continue with passkey</button><p id="status" role="alert"></p>
    <script>
      const bytes = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
      const encoded = value => btoa(String.fromCharCode(...new Uint8Array(value))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
      const status = document.getElementById('status');
      document.getElementById('continue').addEventListener('click', async () => {
        status.textContent = 'Waiting for your passkey…';
        try {
          const optionsResponse = await fetch('./passkey/generate-authenticate-options');
          const optionsBody = await optionsResponse.json();
          if (!optionsResponse.ok) throw new Error(optionsBody.message || 'Passkey is unavailable.');
          const publicKey = optionsBody.options || optionsBody;
          publicKey.challenge = bytes(publicKey.challenge);
          if (publicKey.allowCredentials) publicKey.allowCredentials = publicKey.allowCredentials.map(item => ({...item, id: bytes(item.id)}));
          const credential = await navigator.credentials.get({ publicKey });
          const result = {
            id: credential.id, rawId: encoded(credential.rawId), type: credential.type,
            response: {
              authenticatorData: encoded(credential.response.authenticatorData),
              clientDataJSON: encoded(credential.response.clientDataJSON),
              signature: encoded(credential.response.signature),
              userHandle: credential.response.userHandle ? encoded(credential.response.userHandle) : null
            }, clientExtensionResults: credential.getClientExtensionResults()
          };
          const verify = await fetch('./passkey/verify-authentication', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ response: result }) });
          const verified = await verify.json();
          if (!verify.ok) throw new Error(verified.message || 'This passkey could not be verified.');
          location.assign('./desktop-complete');
        } catch (error) { status.textContent = error.name === 'NotAllowedError' ? 'Passkey sign-in was cancelled.' : error.message; }
      });
    </script>`
  )
}

function resetPasswordPage(token: string) {
  const safeToken = JSON.stringify(token)
  return authPage(
    'Choose a new password',
    'Use a unique passphrase between 12 and 128 characters.',
    `
    <form id="form"><label>New password<input id="password" type="password" minlength="12" maxlength="128" required autocomplete="new-password"></label><button>Update password</button></form><p id="status" role="alert"></p>
    <script>
      const token = ${safeToken}; const status = document.getElementById('status');
      document.getElementById('form').addEventListener('submit', async event => {
        event.preventDefault(); status.textContent = 'Updating password…';
        const response = await fetch('./reset-password', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ token, newPassword: document.getElementById('password').value }) });
        const body = await response.json().catch(() => ({}));
        status.textContent = response.ok ? 'Password updated. You can return to Blame and sign in.' : (body.message || 'This reset link is invalid or expired.');
        if (response.ok) document.getElementById('form').remove();
      });
    </script>`
  )
}

function authPage(title: string, description: string, content: string) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title} · Blame</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#090b12;color:#f7f8fb;font:16px system-ui}.card{width:min(420px,calc(100% - 40px));padding:32px;border:1px solid #2d3140;border-radius:18px;background:#11141e;box-shadow:0 24px 80px #0008}h1{margin:0 0 8px;font-size:26px}p{color:#aeb4c4;line-height:1.5}label{display:grid;gap:8px;margin:24px 0}input,button,a{box-sizing:border-box;width:100%;min-height:48px;border-radius:10px;font:inherit}input{border:1px solid #3a4052;background:#090b12;color:white;padding:0 14px}button,a{display:flex;align-items:center;justify-content:center;border:0;background:#fff;color:#090b12;font-weight:700;cursor:pointer;padding:0 16px;text-decoration:none}button:focus-visible,input:focus-visible,a:focus-visible{outline:3px solid #8d83ff;outline-offset:2px}#status{min-height:24px}</style><main class="card"><strong>Blame</strong><h1>${title}</h1><p>${description}</p>${content}</main></html>`
}
