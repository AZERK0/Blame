import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'provider_credentials'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('auth_method').notNullable().defaultTo('api-key')
      table.text('encrypted_oauth_credentials').nullable()
      table.string('account_id').nullable()
      table.timestamp('expires_at').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('auth_method')
      table.dropColumn('encrypted_oauth_credentials')
      table.dropColumn('account_id')
      table.dropColumn('expires_at')
    })
  }
}
