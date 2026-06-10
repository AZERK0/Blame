import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'user_stories'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('base_commit').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('base_commit')
    })
  }
}
