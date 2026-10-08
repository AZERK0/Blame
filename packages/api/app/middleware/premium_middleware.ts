import PremiumService, { type PremiumFeature } from '#services/premium_service'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

export default class PremiumMiddleware {
  async handle(ctx: HttpContext, next: NextFn, options: { feature: PremiumFeature }) {
    const denial = await new PremiumService().denial(ctx.auth.getUserOrFail().id, options.feature)
    if (denial) return ctx.response.paymentRequired(denial)
    return next()
  }
}
