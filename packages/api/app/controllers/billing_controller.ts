import BillingService, { type BillingCycle } from '#services/billing_service'
import type { HttpContext } from '@adonisjs/core/http'

export default class BillingController {
  async show({ auth }: HttpContext) {
    return new BillingService().reconcile(auth.getUserOrFail().id)
  }

  async checkout({ auth, request, response }: HttpContext) {
    const cycle = request.input('cycle')
    if (cycle !== 'monthly' && cycle !== 'yearly') {
      return response.badRequest({ message: 'Billing cycle must be monthly or yearly' })
    }
    const url = await new BillingService().createCheckout(
      auth.getUserOrFail(),
      cycle as BillingCycle
    )
    return { url }
  }

  async portal({ auth }: HttpContext) {
    return { url: await new BillingService().createPortal(auth.getUserOrFail().id) }
  }
}
