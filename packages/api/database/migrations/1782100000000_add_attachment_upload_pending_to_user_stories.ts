import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('user_stories', (table) => {
      table.boolean('file_attachment_upload_pending').notNullable().defaultTo(false)
    })
  }

  async down() {
    this.schema.alterTable('user_stories', (table) => {
      table.dropColumn('file_attachment_upload_pending')
    })
  }
}
