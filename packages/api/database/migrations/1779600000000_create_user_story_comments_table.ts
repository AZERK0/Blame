import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'user_story_comments'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.uuid('id').primary()
      table
        .uuid('user_story_id')
        .notNullable()
        .references('id')
        .inTable('user_stories')
        .onDelete('CASCADE')
      table.text('body').notNullable()
      table.string('author').notNullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['user_story_id', 'created_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
