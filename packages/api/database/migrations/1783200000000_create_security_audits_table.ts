import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('security_audits', (table) => {
      table.uuid('id').primary()
      table
        .uuid('project_id')
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')
      table.string('status').notNullable()
      table.integer('sequence').unsigned().notNullable()
      table.json('payload').notNullable()
      table.timestamp('started_at').notNullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['project_id', 'started_at'])
      table.index(['project_id', 'status'])
    })
  }

  async down() {
    this.schema.dropTable('security_audits')
  }
}
