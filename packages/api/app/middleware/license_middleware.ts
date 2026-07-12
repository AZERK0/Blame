import BillingService from '#services/billing_service'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

export default class LicenseMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const status = await new BillingService().status(ctx.auth.getUserOrFail().id)
    if (!status.licensed) {
      return ctx.response.paymentRequired({
        code: 'LICENSE_REQUIRED',
        message: 'An active Blame license is required',
      })
    }
    return next()
  }
}
