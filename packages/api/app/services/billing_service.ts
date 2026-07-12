import Stripe from 'stripe'
import env from '#start/env'
import User from '#models/user'
import UserSubscription from '#models/user_subscription'
import StripeWebhookEvent from '#models/stripe_webhook_event'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

export type BillingCycle = 'monthly' | 'yearly'

const licensedStatuses = new Set(['active', 'trialing'])

export default class BillingService {
  private stripeClient() {
    const secretKey = env.get('STRIPE_SECRET_KEY')
    if (!secretKey) throw new Error('Stripe billing is not configured')
    return new Stripe(secretKey)
  }

  private config(
    name:
      | 'STRIPE_MONTHLY_PRICE_ID'
      | 'STRIPE_YEARLY_PRICE_ID'
      | 'STRIPE_CHECKOUT_SUCCESS_URL'
      | 'STRIPE_CHECKOUT_CANCEL_URL'
      | 'STRIPE_PORTAL_RETURN_URL'
      | 'STRIPE_WEBHOOK_SECRET'
  ) {
    const value = env.get(name)
    if (!value) throw new Error('Stripe billing is not configured')
    return value
  }

  async status(userId: string) {
    const subscription = await UserSubscription.find(userId)
    const periodIsCurrent =
      !subscription?.currentPeriodEnd || subscription.currentPeriodEnd > DateTime.utc()
    return {
      licensed: Boolean(
        subscription && licensedStatuses.has(subscription.status) && periodIsCurrent
      ),
      status: subscription?.status ?? 'inactive',
      currentPeriodEnd: subscription?.currentPeriodEnd?.toISO() ?? null,
      cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    }
  }

  async createCheckout(user: User, cycle: BillingCycle) {
    const price = this.config(
      cycle === 'monthly' ? 'STRIPE_MONTHLY_PRICE_ID' : 'STRIPE_YEARLY_PRICE_ID'
    )
    let subscription = await UserSubscription.find(user.id)
    if (subscription && licensedStatuses.has(subscription.status)) {
      throw new Error('An active subscription already exists')
    }

    if (!subscription) {
      const customer = await this.stripeClient().customers.create(
        { email: user.email, name: user.fullName ?? undefined, metadata: { blameUserId: user.id } },
        { idempotencyKey: `blame-customer-${user.id}` }
      )
      subscription = await UserSubscription.firstOrCreate(
        { userId: user.id },
        { stripeCustomerId: customer.id, status: 'inactive' }
      )
    }

    return db.transaction(async (trx) => {
      const locked = await UserSubscription.query({ client: trx })
        .where('user_id', user.id)
        .forUpdate()
        .firstOrFail()
      if (locked.stripeCheckoutSessionId) {
        const existing = await this.stripeClient().checkout.sessions.retrieve(
          locked.stripeCheckoutSessionId
        )
        if (existing.status === 'open' && existing.url) return existing.url
      }

      const session = await this.stripeClient().checkout.sessions.create({
        mode: 'subscription',
        customer: locked.stripeCustomerId,
        client_reference_id: user.id,
        line_items: [{ price, quantity: 1 }],
        allow_promotion_codes: false,
        success_url: this.config('STRIPE_CHECKOUT_SUCCESS_URL'),
        cancel_url: this.config('STRIPE_CHECKOUT_CANCEL_URL'),
        subscription_data: { metadata: { blameUserId: user.id } },
      })
      if (!session.url) throw new Error('Stripe did not return a checkout URL')
      locked.useTransaction(trx)
      locked.stripeCheckoutSessionId = session.id
      await locked.save()
      return session.url
    })
  }

  async createPortal(userId: string) {
    const subscription = await UserSubscription.findOrFail(userId)
    const session = await this.stripeClient().billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: this.config('STRIPE_PORTAL_RETURN_URL'),
    })
    return session.url
  }

  constructEvent(payload: string, signature: string) {
    return this.stripeClient().webhooks.constructEvent(
      payload,
      signature,
      this.config('STRIPE_WEBHOOK_SECRET')
    )
  }

  async processEvent(event: Stripe.Event) {
    await db.transaction(async (trx) => {
      const processed = await StripeWebhookEvent.query({ client: trx })
        .where('id', event.id)
        .first()
      if (processed) return

      if (event.type.startsWith('customer.subscription.')) {
        const stripeSubscription = event.data.object as Stripe.Subscription
        const customerId =
          typeof stripeSubscription.customer === 'string'
            ? stripeSubscription.customer
            : stripeSubscription.customer.id
        const local = await UserSubscription.query({ client: trx })
          .where('stripe_customer_id', customerId)
          .first()
        if (local) {
          if (
            local.lastStripeEventCreatedAt !== null &&
            event.created < local.lastStripeEventCreatedAt
          ) {
            await StripeWebhookEvent.create({ id: event.id, type: event.type }, { client: trx })
            return
          }
          const priceId = stripeSubscription.items.data[0]?.price.id ?? null
          const allowedPrice =
            priceId === this.config('STRIPE_MONTHLY_PRICE_ID') ||
            priceId === this.config('STRIPE_YEARLY_PRICE_ID')
          local.useTransaction(trx)
          local.merge({
            stripeSubscriptionId: stripeSubscription.id,
            stripePriceId: priceId,
            status: allowedPrice ? stripeSubscription.status : 'inactive',
            currentPeriodEnd: DateTime.fromSeconds(
              stripeSubscription.items.data[0]?.current_period_end ?? 0
            ),
            cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
            lastStripeEventCreatedAt: event.created,
          })
          await local.save()
        }
      }

      await StripeWebhookEvent.create({ id: event.id, type: event.type }, { client: trx })
    })
  }
}
