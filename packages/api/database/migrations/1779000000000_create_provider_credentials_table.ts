import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'provider_credentials'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.uuid('id').primary()
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.string('provider_id').notNullable()
      table.string('label').notNullable()
      table.text('encrypted_api_key').notNullable()
      table.string('base_url').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.unique(['user_id', 'provider_id', 'label'])
      table.index(['user_id', 'provider_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
