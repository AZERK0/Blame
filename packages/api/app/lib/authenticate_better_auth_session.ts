import { auth as betterAuth } from '#lib/better_auth'
import User from '#models/user'
import type { HttpContext } from '@adonisjs/core/http'
import { fromNodeHeaders } from 'better-auth/node'

export async function authenticateBetterAuthSession(ctx: HttpContext) {
  const session = await betterAuth.api.getSession({
    headers: fromNodeHeaders(ctx.request.request.headers),
  })
  if (!session) return false

  const user = await User.find(session.user.id)
  if (!user) return false

  await ctx.auth.use('web').login(user)
  await ctx.auth.authenticateUsing(['web'])
  return true
}
