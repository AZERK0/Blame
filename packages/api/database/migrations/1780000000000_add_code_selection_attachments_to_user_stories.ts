import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('user_stories', (table) => {
      table.json('code_selection_attachments').nullable()
    })
    this.schema.alterTable('user_story_comments', (table) => {
      table.json('code_selection_attachments').nullable()
    })
  }

  async down() {
    this.schema.alterTable('user_story_comments', (table) => {
      table.dropColumn('code_selection_attachments')
    })
    this.schema.alterTable('user_stories', (table) => {
      table.dropColumn('code_selection_attachments')
    })
  }
}
