import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('user_subscriptions', (table) => {
      table.uuid('user_id').notNullable().primary().references('users.id').onDelete('CASCADE')
      table.string('stripe_customer_id', 255).notNullable().unique()
      table.string('stripe_subscription_id', 255).nullable().unique()
      table.string('stripe_price_id', 255).nullable()
      table.string('stripe_checkout_session_id', 255).nullable()
      table.bigInteger('last_stripe_event_created_at').nullable()
      table.string('status', 32).notNullable().defaultTo('inactive')
      table.timestamp('current_period_end').nullable()
      table.boolean('cancel_at_period_end').notNullable().defaultTo(false)
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })

    this.schema.createTable('stripe_webhook_events', (table) => {
      table.string('id', 255).primary()
      table.string('type', 255).notNullable()
      table.timestamp('processed_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable('stripe_webhook_events')
    this.schema.dropTable('user_subscriptions')
  }
}
