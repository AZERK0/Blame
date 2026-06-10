import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('project_initializations', (table) => {
      table.json('run_configurations').nullable()
    })
  }

  async down() {
    this.schema.alterTable('project_initializations', (table) => {
      table.dropColumn('run_configurations')
    })
  }
}
