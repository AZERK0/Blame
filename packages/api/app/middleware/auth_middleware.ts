import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import type { Authenticators } from '@adonisjs/auth/types'
import AccountClosureLedgerService from '#services/account_closure_ledger_service'
import { auth as betterAuth } from '#lib/better_auth'
import { fromNodeHeaders } from 'better-auth/node'
import User from '#models/user'

/**
 * Auth middleware is used authenticate HTTP requests and deny
 * access to unauthenticated users.
 */
export default class AuthMiddleware {
  async handle(
    ctx: HttpContext,
    next: NextFn,
    options: {
      guards?: (keyof Authenticators)[]
    } = {}
  ) {
    try {
      await ctx.auth.authenticateUsing(options.guards)
    } catch {
      const session = await betterAuth.api.getSession({
        headers: fromNodeHeaders(ctx.request.request.headers),
      })
      if (!session) return ctx.response.unauthorized({ message: 'Authentication required' })
      const user = await User.find(session.user.id)
      if (!user) return ctx.response.unauthorized({ message: 'Authentication required' })
      await ctx.auth.use('web').login(user)
    }
    const user = ctx.auth.getUserOrFail()
    const closureLedger = new AccountClosureLedgerService()
    if (user.closureRequestedAt || (await closureLedger.hasUser(user.id))) {
      return ctx.response.forbidden({
        code: 'ACCOUNT_CLOSURE_IN_PROGRESS',
        message: 'This account is closed and no longer accepts requests',
      })
    }
    return next()
  }
}
