import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('project_initializations', (table) => {
      table.text('preview_manifest').nullable()
    })
  }

  async down() {
    this.schema.alterTable('project_initializations', (table) => {
      table.dropColumn('preview_manifest')
    })
  }
}
