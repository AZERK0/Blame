import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('user_stories', (table) => {
      table.string('run_configuration_id', 80).nullable()
    })
  }

  async down() {
    this.schema.alterTable('user_stories', (table) => {
      table.dropColumn('run_configuration_id')
    })
  }
}
