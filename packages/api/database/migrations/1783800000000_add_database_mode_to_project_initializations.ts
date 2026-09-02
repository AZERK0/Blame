import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('project_initializations', (table) => {
      table.string('database_mode', 16).nullable()
    })
  }

  async down() {
    this.schema.alterTable('project_initializations', (table) => {
      table.dropColumn('database_mode')
    })
  }
}
