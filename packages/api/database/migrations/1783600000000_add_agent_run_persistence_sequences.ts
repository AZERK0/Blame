import { BaseSchema } from '@adonisjs/lucid/schema'

const runTables = ['user_story_agent_runs', 'quick_chat_agent_runs']

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('quick_chat_agent_runs', (table) => {
      table.uuid('execution_id').nullable()
      table.index(['execution_id'], 'quick_chat_agent_runs_execution_id_index')
    })
    for (const tableName of runTables) {
      this.schema.alterTable(tableName, (table) => {
        table.string('last_event_id', 255).nullable()
        table.bigInteger('last_sequence_number').notNullable().defaultTo(0)
        table.string('last_event_type', 64).nullable()
        table.timestamp('last_event_created_at').nullable()
      })
    }
  }

  async down() {
    for (const tableName of [...runTables].reverse()) {
      this.schema.alterTable(tableName, (table) => {
        table.dropColumn('last_event_created_at')
        table.dropColumn('last_event_type')
        table.dropColumn('last_sequence_number')
        table.dropColumn('last_event_id')
      })
    }
    this.schema.alterTable('quick_chat_agent_runs', (table) => {
      table.dropIndex(['execution_id'], 'quick_chat_agent_runs_execution_id_index')
      table.dropColumn('execution_id')
    })
  }
}
