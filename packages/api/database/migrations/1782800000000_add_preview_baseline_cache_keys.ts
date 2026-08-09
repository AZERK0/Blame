import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('preview_project_baselines', (table) => {
      table.string('cache_key', 64).nullable()
      table.index(['cache_key', 'status', 'expires_at'])
    })
  }

  async down() {
    this.schema.alterTable('preview_project_baselines', (table) => {
      table.dropIndex(['cache_key', 'status', 'expires_at'])
      table.dropColumn('cache_key')
    })
  }
}
