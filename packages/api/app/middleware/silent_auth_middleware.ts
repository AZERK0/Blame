import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { auth as betterAuth } from '#lib/better_auth'
import { fromNodeHeaders } from 'better-auth/node'
import User from '#models/user'

/**
 * Silent auth middleware can be used as a global middleware to silent check
 * if the user is logged-in or not.
 *
 * The request continues as usual, even when the user is not logged-in.
 */
export default class SilentAuthMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const authenticated = await ctx.auth.check()
    if (!authenticated) {
      const session = await betterAuth.api.getSession({
        headers: fromNodeHeaders(ctx.request.request.headers),
      })
      if (session) {
        const user = await User.find(session.user.id)
        if (user) await ctx.auth.use('web').login(user)
      }
    }

    return next()
  }
}
