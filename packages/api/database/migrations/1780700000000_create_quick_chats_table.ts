import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('quick_chats', (table) => {
      table.uuid('id').primary()
      table
        .uuid('project_id')
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')
      table.string('title').notNullable()
      table.text('workspace').nullable()
      table.string('agent_status').nullable()
      table.string('cline_session_id').nullable()
      table.string('agent_provider_id').nullable()
      table.string('agent_model_id').nullable()
      table.text('agent_last_event').nullable()
      table.text('agent_last_error').nullable()
      table.json('agent_activities').nullable()
      table.text('agent_final_response').nullable()
      table.json('agent_usage').nullable()
      table.text('agent_session_summary').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['project_id', 'updated_at'])
    })

    this.schema.createTable('quick_chat_messages', (table) => {
      table.uuid('id').primary()
      table
        .uuid('quick_chat_id')
        .notNullable()
        .references('id')
        .inTable('quick_chats')
        .onDelete('CASCADE')
      table.text('body').notNullable()
      table.json('code_selection_attachments').nullable()
      table.json('file_attachments').nullable()
      table.string('author').notNullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['quick_chat_id', 'created_at'])
    })

    this.schema.createTable('quick_chat_agent_runs', (table) => {
      table.uuid('id').primary()
      table
        .uuid('quick_chat_id')
        .notNullable()
        .references('id')
        .inTable('quick_chats')
        .onDelete('CASCADE')
      table
        .uuid('message_id')
        .nullable()
        .references('id')
        .inTable('quick_chat_messages')
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

      table.index(['quick_chat_id', 'created_at'])
      table.index(['message_id'])
    })
  }

  async down() {
    this.schema.dropTable('quick_chat_agent_runs')
    this.schema.dropTable('quick_chat_messages')
    this.schema.dropTable('quick_chats')
  }
}
