import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('users', (table) => {
      table.integer('privacy_verification_failure_count').unsigned().notNullable().defaultTo(0)
      table.timestamp('privacy_verification_window_started_at').nullable()
      table.timestamp('privacy_verification_blocked_until').nullable()
      table.index(['privacy_verification_blocked_until'])
    })

    this.schema.alterTable('account_closure_requests', (table) => {
      table.string('stripe_price_id', 255).nullable()
      table.string('stripe_checkout_session_id', 255).nullable()
      table.string('subscription_status', 64).nullable()
      table.timestamp('subscription_current_period_end').nullable()
      table.boolean('subscription_cancel_at_period_end').nullable()
      table.timestamp('subscription_created_at').nullable()
      table.timestamp('subscription_updated_at').nullable()
    })
  }

  async down() {
    this.schema.alterTable('account_closure_requests', (table) => {
      table.dropColumn('subscription_updated_at')
      table.dropColumn('subscription_created_at')
      table.dropColumn('subscription_cancel_at_period_end')
      table.dropColumn('subscription_current_period_end')
      table.dropColumn('subscription_status')
      table.dropColumn('stripe_checkout_session_id')
      table.dropColumn('stripe_price_id')
    })

    this.schema.alterTable('users', (table) => {
      table.dropIndex(['privacy_verification_blocked_until'])
      table.dropColumn('privacy_verification_blocked_until')
      table.dropColumn('privacy_verification_window_started_at')
      table.dropColumn('privacy_verification_failure_count')
    })
  }
}
