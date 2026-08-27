import { BaseSchema } from '@adonisjs/lucid/schema'

const indexName = 'user_story_agent_runs_status_story_created_id_index'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('user_story_agent_runs', (table) => {
      table.index(['status', 'user_story_id', 'created_at', 'id'], indexName)
    })
  }

  async down() {
    this.schema.alterTable('user_story_agent_runs', (table) => {
      table.dropIndex(['status', 'user_story_id', 'created_at', 'id'], indexName)
    })
  }
}
