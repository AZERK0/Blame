import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'model_catalog_snapshots'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('id', 40).primary()
      table.string('catalog_hash', 64).notNullable()
      table.text('payload', 'longtext').notNullable()
      table.timestamp('refreshed_at').notNullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
