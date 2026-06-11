import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'provider_credentials'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.text('model_ids').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('model_ids')
    })
  }
}
