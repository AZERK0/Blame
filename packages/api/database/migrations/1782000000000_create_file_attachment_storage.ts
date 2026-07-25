import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('file_attachments', (table) => {
      table.uuid('id').primary()
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.string('object_key', 255).notNullable().unique()
      table.string('name', 255).notNullable()
      table.string('mime_type', 255).notNullable()
      table.integer('size').unsigned().notNullable()
      table.string('checksum_sha256', 64).notNullable()
      table.text('ai_context_markdown', 'longtext').nullable()
      table.string('status', 32).notNullable()
      table.timestamp('uploaded_at').nullable()
      table.timestamp('detached_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
      table.index(['user_id', 'status'])
      table.index(['status', 'detached_at'])
    })

    this.createPivot('user_story_file_attachments', 'user_story_id', 'user_stories', 'usfa')
    this.createPivot(
      'user_story_comment_file_attachments',
      'user_story_comment_id',
      'user_story_comments',
      'uscfa'
    )
    this.createPivot(
      'quick_chat_message_file_attachments',
      'quick_chat_message_id',
      'quick_chat_messages',
      'qcmfa'
    )
  }

  async down() {
    this.schema.dropTable('quick_chat_message_file_attachments')
    this.schema.dropTable('user_story_comment_file_attachments')
    this.schema.dropTable('user_story_file_attachments')
    this.schema.dropTable('file_attachments')
  }

  private createPivot(
    tableName: string,
    ownerColumn: string,
    ownerTable: string,
    keyPrefix: string
  ) {
    this.schema.createTable(tableName, (table) => {
      table.uuid(ownerColumn).notNullable()
      table.uuid('file_attachment_id').notNullable()
      table.integer('position').unsigned().notNullable()
      table.primary([ownerColumn, 'file_attachment_id'])
      table
        .foreign(ownerColumn, `${keyPrefix}_owner_fk`)
        .references('id')
        .inTable(ownerTable)
        .onDelete('CASCADE')
      table
        .foreign('file_attachment_id', `${keyPrefix}_attachment_fk`)
        .references('id')
        .inTable('file_attachments')
        .onDelete('CASCADE')
      table.index(['file_attachment_id'], `${keyPrefix}_attachment_idx`)
    })
  }
}
