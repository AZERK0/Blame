import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('preview_sessions', (table) => {
      table.string('workspace_hash', 64).nullable()
      table.text('provision_source', 'longtext').nullable()
    })
  }

  async down() {
    this.schema.alterTable('preview_sessions', (table) => {
      table.dropColumn('provision_source')
      table.dropColumn('workspace_hash')
    })
  }
}
