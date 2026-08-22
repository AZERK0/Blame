import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('user_story_agent_runs', (table) => {
      table.uuid('execution_id').nullable()
      table.index(['execution_id'], 'user_story_agent_runs_execution_id_index')
    })
    this.schema.alterTable('user_stories', (table) => {
      table.uuid('active_agent_run_id').nullable()
      table.index(['active_agent_run_id'], 'user_stories_active_agent_run_id_index')
      table
        .foreign('active_agent_run_id', 'user_stories_active_agent_run_id_foreign')
        .references('id')
        .inTable('user_story_agent_runs')
        .onDelete('SET NULL')
    })
    this.defer(async (db) => {
      await db.rawQuery(`
        UPDATE user_stories AS story
        SET active_agent_run_id = (
          SELECT run.id
          FROM user_story_agent_runs AS run
          WHERE run.user_story_id = story.id AND run.status = 'running'
          ORDER BY run.created_at DESC, run.id DESC
          LIMIT 1
        )
        WHERE story.status = 'in-progress' AND story.agent_status = 'Running'
      `)
    })
  }

  async down() {
    this.schema.alterTable('user_stories', (table) => {
      table.dropForeign('active_agent_run_id', 'user_stories_active_agent_run_id_foreign')
      table.dropIndex(['active_agent_run_id'], 'user_stories_active_agent_run_id_index')
      table.dropColumn('active_agent_run_id')
    })
    this.schema.alterTable('user_story_agent_runs', (table) => {
      table.dropIndex(['execution_id'], 'user_story_agent_runs_execution_id_index')
      table.dropColumn('execution_id')
    })
  }
}
