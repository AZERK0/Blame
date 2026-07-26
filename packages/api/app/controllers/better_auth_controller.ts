import { auth } from '#lib/better_auth'
import { sitePageUrl } from '#lib/site_url'
import type { HttpContext } from '@adonisjs/core/http'

export default class BetterAuthController {
  async handle({ request, response }: HttpContext) {
    const headers = new Headers()
    for (const [name, value] of Object.entries(request.headers())) {
      if (Array.isArray(value)) value.forEach((entry) => headers.append(name, entry))
      else if (value !== undefined) headers.set(name, value)
    }

    const method = request.method()
    const body = ['GET', 'HEAD'].includes(method) ? undefined : JSON.stringify(request.body())
    if (body && !headers.has('content-type')) headers.set('content-type', 'application/json')
    const authResponse = await auth.handler(
      new Request(authenticationUrl(request), { method, headers, body })
    )

    return response.send(authResponse)
  }
}

function authenticationUrl(request: HttpContext['request']) {
  const url = new URL(request.completeUrl(true))
  if (!url.pathname.endsWith('/auth/verify-email')) return url
  const callback = url.searchParams.get('callbackURL')
  if (!usesLegacyVerificationPage(callback, url)) return url
  url.searchParams.set('callbackURL', sitePageUrl('/auth/verify-email', { verified: 'true' }))
  return url
}

function usesLegacyVerificationPage(callback: string | null, requestUrl: URL) {
  if (!callback || callback === '/') return true
  return new URL(callback, requestUrl).pathname === '/api/v1/auth/verified'
}
