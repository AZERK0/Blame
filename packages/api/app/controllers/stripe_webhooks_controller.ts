import BillingService from '#services/billing_service'
import type { HttpContext } from '@adonisjs/core/http'
import Stripe from 'stripe'

export default class StripeWebhooksController {
  async handle({ request, response }: HttpContext) {
    const signature = request.header('stripe-signature')
    const payload = request.raw()
    if (!signature || typeof payload !== 'string') {
      return response.badRequest({ message: 'Missing Stripe signature or payload' })
    }

    try {
      const billing = new BillingService()
      const event = billing.constructEvent(payload, signature)
      await billing.processEvent(event)
      return { received: true }
    } catch (error) {
      if (error instanceof Stripe.errors.StripeSignatureVerificationError) {
        return response.badRequest({ message: 'Invalid Stripe webhook signature' })
      }
      throw error
    }
  }
}
