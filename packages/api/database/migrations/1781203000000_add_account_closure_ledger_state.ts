import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('account_closure_requests', (table) => {
      table.timestamp('ledger_recorded_at').nullable()
      table.index(['ledger_recorded_at'])
    })
  }

  async down() {
    this.schema.alterTable('account_closure_requests', (table) => {
      table.dropIndex(['ledger_recorded_at'])
      table.dropColumn('ledger_recorded_at')
    })
  }
}
