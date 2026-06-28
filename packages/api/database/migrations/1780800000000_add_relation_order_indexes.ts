import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    await this.schema.alterTable('user_story_comments', (table) => {
      table.dropIndex(['user_story_id', 'created_at'])
      table.index(['user_story_id', 'created_at', 'id'])
    })

    await this.schema.alterTable('user_story_agent_runs', (table) => {
      table.dropIndex(['user_story_id', 'created_at'])
      table.index(['user_story_id', 'created_at', 'id'])
    })

    await this.schema.alterTable('quick_chat_messages', (table) => {
      table.dropIndex(['quick_chat_id', 'created_at'])
      table.index(['quick_chat_id', 'created_at', 'id'])
    })

    await this.schema.alterTable('quick_chat_agent_runs', (table) => {
      table.dropIndex(['quick_chat_id', 'created_at'])
      table.index(['quick_chat_id', 'created_at', 'id'])
    })
  }

  async down() {
    await this.schema.alterTable('quick_chat_agent_runs', (table) => {
      table.dropIndex(['quick_chat_id', 'created_at', 'id'])
      table.index(['quick_chat_id', 'created_at'])
    })

    await this.schema.alterTable('quick_chat_messages', (table) => {
      table.dropIndex(['quick_chat_id', 'created_at', 'id'])
      table.index(['quick_chat_id', 'created_at'])
    })

    await this.schema.alterTable('user_story_agent_runs', (table) => {
      table.dropIndex(['user_story_id', 'created_at', 'id'])
      table.index(['user_story_id', 'created_at'])
    })

    await this.schema.alterTable('user_story_comments', (table) => {
      table.dropIndex(['user_story_id', 'created_at', 'id'])
      table.index(['user_story_id', 'created_at'])
    })
  }
}
