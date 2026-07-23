import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('user_story_agent_runs', (table) => {
      table.integer('checkpoint_run_count').unsigned().nullable()
    })
    this.schema.alterTable('quick_chat_agent_runs', (table) => {
      table.integer('checkpoint_run_count').unsigned().nullable()
    })
  }

  async down() {
    this.schema.alterTable('quick_chat_agent_runs', (table) => {
      table.dropColumn('checkpoint_run_count')
    })
    this.schema.alterTable('user_story_agent_runs', (table) => {
      table.dropColumn('checkpoint_run_count')
    })
  }
}