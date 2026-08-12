import {
  consumePreviewManifest,
  consumeRunConfigurations,
  prepareRunConfigurations,
} from '#models/project_initialization'
import { clearProjectInitializations } from '../../database/migrations/1783100000000_drop_derived_project_initialization_artifacts.js'
import { test } from '@japa/runner'

const configurations = [
  {
    id: 'web',
    name: 'Web application',
    command: 'pnpm dev',
    cwd: '.',
    default: true,
    category: 'web' as const,
    services: ['web'],
    previewService: 'web',
    scopes: ['frontend'],
    previewUrl: 'http://localhost:5173/',
  },
]

test.group('project initialization model', () => {
  test('serializes run configurations for MySQL JSON columns', ({ assert }) => {
    assert.equal(prepareRunConfigurations(configurations), JSON.stringify(configurations))
  })

  test('consumes run configurations returned by MySQL', ({ assert }) => {
    assert.deepEqual(consumeRunConfigurations(JSON.stringify(configurations)), configurations)
    assert.deepEqual(consumeRunConfigurations(configurations), configurations)
  })

  test('rejects malformed stored initialization state', ({ assert }) => {
    assert.throws(() => consumeRunConfigurations('{}'), /must be an array/)
    assert.throws(
      () => consumePreviewManifest(JSON.stringify({ version: 1 })),
      /unsupported field version/
    )
  })

  test('resets only project initialization state at the canonical cutover', async ({ assert }) => {
    const touchedTables: string[] = []
    await clearProjectInitializations({
      from(table) {
        touchedTables.push(table)
        return { delete: async () => 1 }
      },
    })

    assert.deepEqual(touchedTables, ['project_initializations'])
  })
})
