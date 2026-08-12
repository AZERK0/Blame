import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('project_initializations', (table) => {
      table.dropColumn('setup_script')
      table.dropColumn('docker_compose')
    })
    this.defer(async (db) => {
      await clearProjectInitializations(db)
    })
  }

  async down() {
    // Destructive canonical cutover: removed artifacts and rows are not restored.
  }
}

type InitializationDatabase = {
  from(table: string): { delete(): Promise<unknown> }
}

export function clearProjectInitializations(database: InitializationDatabase) {
  return database.from('project_initializations').delete()
}
