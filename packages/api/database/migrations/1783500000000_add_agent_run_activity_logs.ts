import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('user_story_agent_run_activities', (table) => {
      table.uuid('id').primary()
      table
        .uuid('run_id')
        .notNullable()
        .references('id')
        .inTable('user_story_agent_runs')
        .onDelete('CASCADE')
      table.string('activity_id', 255).notNullable()
      table.json('activity').notNullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
      table.unique(['run_id', 'activity_id'])
    })
    this.schema.createTable('quick_chat_agent_run_activities', (table) => {
      table.uuid('id').primary()
      table
        .uuid('run_id')
        .notNullable()
        .references('id')
        .inTable('quick_chat_agent_runs')
        .onDelete('CASCADE')
      table.string('activity_id', 255).notNullable()
      table.json('activity').notNullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
      table.unique(['run_id', 'activity_id'])
    })
  }

  async down() {
    this.schema.dropTable('quick_chat_agent_run_activities')
    this.schema.dropTable('user_story_agent_run_activities')
  }
}
