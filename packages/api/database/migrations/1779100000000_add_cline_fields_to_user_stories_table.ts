import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'user_stories'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('cline_session_id').nullable()
      table.string('agent_provider_id').nullable()
      table.string('agent_model_id').nullable()
      table.text('agent_last_event').nullable()
      table.text('agent_last_error').nullable()
      table.index(['cline_session_id'])
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropIndex(['cline_session_id'])
      table.dropColumn('cline_session_id')
      table.dropColumn('agent_provider_id')
      table.dropColumn('agent_model_id')
      table.dropColumn('agent_last_event')
      table.dropColumn('agent_last_error')
    })
  }
}
