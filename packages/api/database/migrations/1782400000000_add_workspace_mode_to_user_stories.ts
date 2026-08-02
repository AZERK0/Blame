import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('user_stories', (table) => {
      table.string('workspace_mode', 32).nullable().after('worktree')
    })
  }

  async down() {
    this.schema.alterTable('user_stories', (table) => {
      table.dropColumn('workspace_mode')
    })
  }
}
