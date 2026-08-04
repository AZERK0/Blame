import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Destructive, intentional reset for the unversioned canonical manifest.
 * Only initialization artifacts are deleted. Projects, stories,
 * conversations, attachments and code-practice preferences are untouched.
 * The next project/story preparation regenerates and overwrites
 * `.blame/initialization` from the canonical manifest.
 */
export default class extends BaseSchema {
  async up() {
    await resetCanonicalPreviewInitializations(this.db)
  }

  async down() {
    // Intentionally empty: deleted initialization data cannot be restored.
  }
}

type InitializationResetDatabase = {
  from(table: string): { delete(): Promise<unknown> }
}

export function resetCanonicalPreviewInitializations(database: InitializationResetDatabase) {
  return database.from('project_initializations').delete()
}
