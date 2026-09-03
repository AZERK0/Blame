import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('project_agent_memories', (table) => {
      table.uuid('id').primary()
      table
        .uuid('project_id')
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')
      table.string('fingerprint', 64).notNullable()
      table.text('objective').notNullable()
      table.text('summary').notNullable()
      table.json('files').notNullable()
      table.json('symbols').notNullable()
      table.string('source_revision_id', 128).notNullable()
      table.string('story_id', 255).nullable()
      table.string('validation_kind', 64).nullable()
      table.string('validation_task_id', 255).nullable()
      table.timestamp('created_at').notNullable()

      table.unique(['project_id', 'fingerprint'])
      table.index(['project_id', 'created_at'])
    })
  }

  async down() {
    this.schema.dropTable('project_agent_memories')
  }
}
