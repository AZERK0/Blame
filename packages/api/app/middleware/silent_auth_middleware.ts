import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { authenticateBetterAuthSession } from '#lib/authenticate_better_auth_session'

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
      await authenticateBetterAuthSession(ctx)
    }

    return next()
  }
}
