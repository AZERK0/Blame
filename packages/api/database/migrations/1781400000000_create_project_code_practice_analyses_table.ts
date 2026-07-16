import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('project_code_practice_analyses', (table) => {
      table.uuid('project_id').primary().references('id').inTable('projects').onDelete('CASCADE')
      table.string('status').notNullable()
      table.string('cline_session_id').nullable()
      table.string('agent_provider_id').nullable()
      table.string('agent_model_id').nullable()
      table.text('error').nullable()
      table.timestamp('viewed_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable('project_code_practice_analyses')
  }
}
