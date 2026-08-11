import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('preview_sessions', (table) => {
      table
        .timestamp('state_changed_at')
        .notNullable()
        .defaultTo(this.now())
        .after('last_activity_at')
    })
  }

  async down() {
    this.schema.alterTable('preview_sessions', (table) => {
      table.dropColumn('state_changed_at')
    })
  }
}
