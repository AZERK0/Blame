import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('auth_device_codes', (table) => {
      table.uuid('id').primary()
      table.string('device_code', 64).notNullable().unique()
      table.string('user_code', 16).notNullable().unique()
      table.uuid('user_id').nullable().references('id').inTable('users').onDelete('CASCADE')
      table.timestamp('expires_at').notNullable()
      table.string('status', 16).notNullable()
      table.timestamp('last_polled_at').nullable()
      table.integer('polling_interval').unsigned().nullable()
      table.string('client_id', 128).nullable()
      table.text('scope').nullable()
      table.index(['expires_at'])
      table.index(['status'])
    })
  }

  async down() {
    this.schema.dropTable('auth_device_codes')
  }
}
