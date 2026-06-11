import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'user_ai_preferences'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table
        .integer('user_id')
        .unsigned()
        .notNullable()
        .primary()
        .references('users.id')
        .onDelete('CASCADE')
      table.string('alternative_provider_id').notNullable()
      table.string('alternative_model_id').notNullable()
      table.string('alternative_credential_label').nullable()
      table.string('alternative_reasoning_effort').nullable()
      table.string('agent_provider_id').notNullable()
      table.string('agent_model_id').notNullable()
      table.string('agent_credential_label').nullable()
      table.string('agent_reasoning_effort').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
