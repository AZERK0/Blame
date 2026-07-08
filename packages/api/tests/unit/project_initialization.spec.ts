import { consumeRunConfigurations, prepareRunConfigurations } from '#models/project_initialization'
import { test } from '@japa/runner'

const configurations = [
  {
    id: 'web',
    name: 'Web application',
    command: 'pnpm dev',
    cwd: '.',
    default: true,
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
})
