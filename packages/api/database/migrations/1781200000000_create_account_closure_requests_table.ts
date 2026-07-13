import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('users', (table) => {
      table.timestamp('closure_requested_at').nullable()
      table.timestamp('active_deletion_deadline').nullable()
      table.index(['closure_requested_at'])
    })

    this.schema.createTable('account_closure_requests', (table) => {
      table.uuid('id').primary()
      table.uuid('source_user_id').notNullable().unique()
      table.string('email_fingerprint', 64).notNullable()
      table.string('stripe_customer_id', 255).nullable()
      table.string('stripe_subscription_id', 255).nullable()
      table.string('status', 32).notNullable()
      table.integer('retry_count').unsigned().notNullable().defaultTo(0)
      table.text('last_error').nullable()
      table.timestamp('next_retry_at').nullable()
      table.timestamp('requested_at').notNullable()
      table.timestamp('active_deletion_deadline').notNullable()
      table.timestamp('active_deletion_completed_at').nullable()
      table.timestamp('external_cleanup_completed_at').nullable()
      table.timestamp('backup_expiration_deadline').nullable()
      table.timestamp('retain_until').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['status', 'next_retry_at'])
      table.index(['active_deletion_deadline'])
      table.index(['retain_until'])
    })
  }

  async down() {
    this.schema.dropTable('account_closure_requests')
    this.schema.alterTable('users', (table) => {
      table.dropIndex(['closure_requested_at'])
      table.dropColumn('active_deletion_deadline')
      table.dropColumn('closure_requested_at')
    })
  }
}
