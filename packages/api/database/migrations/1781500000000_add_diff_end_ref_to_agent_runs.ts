import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('user_story_agent_runs', (table) => {
      table.string('diff_end_ref', 64).nullable()
    })
    this.schema.alterTable('quick_chat_agent_runs', (table) => {
      table.string('diff_end_ref', 64).nullable()
    })
  }

  async down() {
    this.schema.alterTable('quick_chat_agent_runs', (table) => {
      table.dropColumn('diff_end_ref')
    })
    this.schema.alterTable('user_story_agent_runs', (table) => {
      table.dropColumn('diff_end_ref')
    })
  }
}
