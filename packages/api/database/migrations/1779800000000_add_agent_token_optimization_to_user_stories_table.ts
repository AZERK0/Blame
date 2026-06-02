import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'user_stories'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.json('agent_usage').nullable()
      table.text('agent_session_summary').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('agent_usage')
      table.dropColumn('agent_session_summary')
    })
  }
}
