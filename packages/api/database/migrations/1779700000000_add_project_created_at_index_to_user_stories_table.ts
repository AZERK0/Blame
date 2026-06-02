import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'user_stories'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.index(['project_id', 'created_at'])
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropIndex(['project_id', 'created_at'])
    })
  }
}
