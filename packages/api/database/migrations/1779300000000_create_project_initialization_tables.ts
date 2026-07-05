import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('project_initializations', (table) => {
      table.uuid('project_id').primary().references('id').inTable('projects').onDelete('CASCADE')
      table.string('status').notNullable()
      table.string('step').notNullable()
      table.string('cline_session_id').nullable()
      table.string('agent_provider_id').nullable()
      table.string('agent_model_id').nullable()
      table.text('setup_script').nullable()
      table.text('docker_compose').nullable()
      table.text('error').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })

    this.schema.createTable('project_code_practices', (table) => {
      table.uuid('id').primary()
      table
        .uuid('project_id')
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')
      table.string('practice').notNullable()
      table.boolean('detected').notNullable()
      table.text('comment').notNullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.unique(['project_id', 'practice'])
      table.index(['project_id'])
    })
  }

  async down() {
    this.schema.dropTable('project_code_practices')
    this.schema.dropTable('project_initializations')
  }
}
