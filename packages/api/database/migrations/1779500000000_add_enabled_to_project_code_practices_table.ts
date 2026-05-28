import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('project_code_practices', (table) => {
      table.boolean('enabled').notNullable().defaultTo(false)
    })

    this.defer(async (db) => {
      await db.rawQuery('UPDATE project_code_practices SET enabled = detected')
    })
  }

  async down() {
    this.schema.alterTable('project_code_practices', (table) => {
      table.dropColumn('enabled')
    })
  }
}
