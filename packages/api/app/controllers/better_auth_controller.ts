import { auth } from '#lib/better_auth'
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
      new Request(request.completeUrl(true), { method, headers, body })
    )

    response.status(authResponse.status)
    authResponse.headers.forEach((value, name) => response.append(name, value))
    const contentType = authResponse.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      return response.send(await authResponse.json())
    }
    return response.send(await authResponse.text())
  }
}
