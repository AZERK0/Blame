import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('project_initializations', (table) => {
      table.text('repair_reason').nullable()
    })
  }

  async down() {
    this.schema.alterTable('project_initializations', (table) => {
      table.dropColumn('repair_reason')
    })
  }
}
