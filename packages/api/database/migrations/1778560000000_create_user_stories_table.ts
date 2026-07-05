import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'user_stories'

  async up() {
    this.schema.createTable('projects', (table) => {
      table.uuid('id').primary()
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.string('repository_fingerprint').nullable()
      table.string('name').notNullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.unique(['user_id', 'repository_fingerprint'])
      table.index(['user_id'])
    })

    this.schema.createTable(this.tableName, (table) => {
      table.uuid('id').primary()
      table
        .uuid('project_id')
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')
      table.integer('story_number').unsigned().notNullable()
      table.string('title').notNullable()
      table.text('summary').notNullable()
      table.string('status').notNullable()
      table.string('priority').notNullable()
      table.string('owner').notNullable()
      table.string('branch').nullable()
      table.string('preview_url').nullable()
      table.string('worktree').nullable()
      table.string('agent_status').nullable()
      table.timestamp('merged_at').nullable()
      table.string('merge_commit').nullable()
      table.string('discarded_reason').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['project_id', 'status'])
      table.unique(['project_id', 'story_number'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
    this.schema.dropTable('projects')
  }
}
