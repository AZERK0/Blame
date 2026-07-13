import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('account_closure_requests', (table) => {
      table.string('receipt_token_hash', 64).nullable()
      table.timestamp('processing_started_at').nullable()
      table.timestamp('active_deletion_deadline_breached_at').nullable()
      table.index(['processing_started_at'])
    })
  }

  async down() {
    this.schema.alterTable('account_closure_requests', (table) => {
      table.dropIndex(['processing_started_at'])
      table.dropColumn('active_deletion_deadline_breached_at')
      table.dropColumn('processing_started_at')
      table.dropColumn('receipt_token_hash')
    })
  }
}
