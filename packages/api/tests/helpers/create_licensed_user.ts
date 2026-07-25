import User from '#models/user'
import UserSubscription from '#models/user_subscription'
import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'

export async function createLicensedUser() {
  const user = await User.create({
    email: `${randomUUID()}@example.com`,
    password: 'password123',
  })
  await UserSubscription.create({
    cancelAtPeriodEnd: false,
    currentPeriodEnd: DateTime.utc().plus({ days: 30 }),
    status: 'active',
    stripeCheckoutSessionId: `cs_${user.id}`,
    stripeCustomerId: `cus_${user.id}`,
    stripePriceId: 'price_test',
    stripeSubscriptionId: `sub_${user.id}`,
    userId: user.id,
  })
  return user
}
