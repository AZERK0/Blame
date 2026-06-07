import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'user_story_agent_runs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table
        .integer('user_story_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('user_stories')
        .onDelete('CASCADE')
      table
        .integer('comment_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('user_story_comments')
        .onDelete('SET NULL')
      table.string('kind').notNullable()
      table.string('cline_session_id').nullable()
      table.string('status').notNullable()
      table.json('activities').nullable()
      table.text('final_response').nullable()
      table.json('usage').nullable()
      table.text('session_summary').nullable()
      table.timestamp('completed_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['user_story_id', 'created_at'])
      table.index(['comment_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
