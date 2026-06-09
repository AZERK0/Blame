import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    await this.addFileAttachmentsColumn('user_stories')
    await this.addFileAttachmentsColumn('user_story_comments')
  }

  async down() {
    await this.dropFileAttachmentsColumn('user_story_comments')
    await this.dropFileAttachmentsColumn('user_stories')
  }

  private async addFileAttachmentsColumn(tableName: string) {
    if (await this.schema.hasColumn(tableName, 'file_attachments')) {
      return
    }

    this.schema.alterTable(tableName, (table) => {
      table.json('file_attachments').nullable()
    })
  }

  private async dropFileAttachmentsColumn(tableName: string) {
    if (!(await this.schema.hasColumn(tableName, 'file_attachments'))) {
      return
    }

    this.schema.alterTable(tableName, (table) => {
      table.dropColumn('file_attachments')
    })
  }
}
