import { resetCanonicalPreviewInitializations } from '../../database/migrations/1782700000000_reset_project_initializations_for_canonical_manifest.js'
import { test } from '@japa/runner'

test.group('canonical preview manifest reset migration', () => {
  test('deletes only project initializations', async ({ assert }) => {
    const touchedTables: string[] = []
    const database = {
      from(table: string) {
        touchedTables.push(table)
        return { delete: async () => 1 }
      },
    }

    await resetCanonicalPreviewInitializations(database)

    assert.deepEqual(touchedTables, ['project_initializations'])
  })
})
