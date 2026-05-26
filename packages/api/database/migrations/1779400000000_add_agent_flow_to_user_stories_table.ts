import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'user_stories'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.json('agent_activities').nullable()
      table.text('agent_final_response').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('agent_activities')
      table.dropColumn('agent_final_response')
    })
  }
}
