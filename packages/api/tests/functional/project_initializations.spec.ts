import Project from '#models/project'
import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'

type InitializationBody = {
  data: {
    initialization: {
      status: string
      clineSessionId: string | null
      previewManifest: Record<string, unknown> | null
      setupScript: string | null
      dockerCompose: string | null
      runConfigurations: Array<{
        id: string
        name: string
        command: string
        cwd: string
        default: boolean
        category?: string
        services?: string[]
        previewService?: string | null
        scopes?: string[]
      }>
      error: string | null
      repairReason: string | null
    } | null
    practices: Array<{
      practice: string
      detected: boolean
      enabled: boolean
      comment: string
    }>
  }
}

test.group('project initializations', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => testUtils.db().truncate())

  test('tracks initialization state and practices', async ({ client, assert }) => {
    const user = await createUser()
    const project = await createProject(user.id, 'Alpha')

    const startResponse = await client
      .post(`/api/v1/projects/${project.id}/initialization/start`)
      .loginAs(user)
      .json({
        providerId: 'anthropic',
        modelId: 'claude',
      })

    startResponse.assertStatus(200)
    const started = startResponse.body() as InitializationBody
    assert.equal(started.data.initialization?.status, 'running')

    const completeResponse = await client
      .post(`/api/v1/projects/${project.id}/initialization/complete`)
      .loginAs(user)
      .json({
        clineSessionId: 'session-1',
        previewManifest: previewManifest('high'),
        setupScript: '#!/usr/bin/env bash\npnpm install',
        dockerCompose: 'services:\n  web:\n    image: node',
        runConfigurations: [
          {
            id: 'web',
            name: 'Web application',
            command: 'pnpm dev',
            cwd: '.',
            default: true,
            category: 'web',
            services: ['web'],
            previewService: 'web',
            scopes: ['frontend', 'backend'],
          },
        ],
        practices: [
          { practice: 'coding_style', detected: false, comment: 'No style config found.' },
          { practice: 'unit_tests', detected: false, comment: 'No test runner found.' },
          { practice: 'layered_architecture', detected: true, comment: 'Modules are separated.' },
          { practice: 'commit_message_convention', detected: false, comment: 'Messages vary.' },
        ],
      })

    completeResponse.assertStatus(200)
    const completed = completeResponse.body() as InitializationBody
    assert.equal(completed.data.initialization?.status, 'done')
    assert.equal(completed.data.initialization?.clineSessionId, 'session-1')
    assert.equal(completed.data.initialization?.previewManifest?.version, 1)
    assert.equal(completed.data.initialization?.runConfigurations[0]?.command, 'pnpm dev')
    assert.equal(completed.data.initialization?.runConfigurations[0]?.category, 'web')
    assert.deepEqual(completed.data.initialization?.runConfigurations[0]?.services, ['web'])
    assert.lengthOf(completed.data.practices, 4)
    assert.isTrue(completed.data.practices.some((practice) => practice.detected))
    assert.isTrue(
      completed.data.practices.some(
        (practice) => practice.practice === 'coding_style' && !practice.detected && practice.enabled
      )
    )
    assert.isTrue(
      completed.data.practices
        .filter((practice) => practice.practice !== 'coding_style')
        .every((practice) => practice.enabled === practice.detected)
    )
  })

  test('stores initialization failures', async ({ client, assert }) => {
    const user = await createUser()
    const project = await createProject(user.id, 'Alpha')

    const response = await client
      .post(`/api/v1/projects/${project.id}/initialization/fail`)
      .loginAs(user)
      .json({
        error: 'Agent failed',
      })

    response.assertStatus(200)
    const body = response.body() as InitializationBody
    assert.equal(body.data.initialization?.status, 'error')
    assert.equal(body.data.initialization?.error, 'Agent failed')
  })

  test('repairs initialization artifacts without changing practices', async ({
    client,
    assert,
  }) => {
    const user = await createUser()
    const project = await createProject(user.id, 'Alpha')
    await client
      .post(`/api/v1/projects/${project.id}/initialization/complete`)
      .loginAs(user)
      .json({
        setupScript: '#!/usr/bin/env bash\npnpm install',
        previewManifest: previewManifest('medium'),
        dockerCompose: 'services:\n  web:\n    image: node',
        runConfigurations: [],
        practices: [
          { practice: 'coding_style', detected: false, comment: 'No style config found.' },
          { practice: 'unit_tests', detected: false, comment: 'No test runner found.' },
          { practice: 'layered_architecture', detected: true, comment: 'Modules are separated.' },
          { practice: 'commit_message_convention', detected: false, comment: 'Messages vary.' },
        ],
      })

    const response = await client
      .post(`/api/v1/projects/${project.id}/initialization/repair`)
      .loginAs(user)
      .json({
        clineSessionId: 'repair-session',
        previewManifest: previewManifest('high'),
        setupScript: '#!/usr/bin/env bash\ncorepack pnpm install',
        dockerCompose: 'services:\n  web:\n    image: node:22',
        runConfigurations: [
          {
            id: 'web',
            name: 'Web application',
            command: 'corepack pnpm dev',
            cwd: 'apps/web',
            default: true,
          },
        ],
        reason: 'The previous command forwarded invalid arguments.',
      })

    response.assertStatus(200)
    const body = response.body() as InitializationBody
    assert.equal(body.data.initialization?.status, 'done')
    assert.equal(body.data.initialization?.clineSessionId, 'repair-session')
    assert.equal(
      body.data.initialization?.repairReason,
      'The previous command forwarded invalid arguments.'
    )
    assert.equal(body.data.initialization?.previewManifest?.confidence, 'high')
    assert.equal(
      body.data.initialization?.setupScript,
      '#!/usr/bin/env bash\ncorepack pnpm install'
    )
    assert.equal(body.data.initialization?.runConfigurations[0]?.command, 'corepack pnpm dev')
    assert.lengthOf(body.data.practices, 4)
    assert.isTrue(
      body.data.practices.some((practice) => practice.practice === 'layered_architecture')
    )
  })

  test('rejects initialization repair for another user project', async ({ client }) => {
    const owner = await createUser()
    const user = await createUser()
    const project = await createProject(owner.id, 'Alpha')

    const response = await client
      .post(`/api/v1/projects/${project.id}/initialization/repair`)
      .loginAs(user)
      .json({
        setupScript: 'pnpm install',
        dockerCompose: 'services:\n  web:\n    image: node',
        reason: 'Repair',
      })

    response.assertStatus(404)
  })

  test('rejects an invalid preview manifest before persistence', async ({ client }) => {
    const user = await createUser()
    const project = await createProject(user.id, 'Alpha')

    const response = await client
      .post(`/api/v1/projects/${project.id}/initialization/complete`)
      .loginAs(user)
      .json({
        previewManifest: { version: 2, confidence: 'high' },
        setupScript: 'pnpm install',
        dockerCompose: 'services:\n  web:\n    image: node',
        practices: [],
      })

    response.assertStatus(422)
  })

  test('rejects run configurations outside the preview topology', async ({ client }) => {
    const user = await createUser()
    const project = await createProject(user.id, 'Alpha')
    const response = await client
      .post(`/api/v1/projects/${project.id}/initialization/complete`)
      .loginAs(user)
      .json({
        previewManifest: previewManifest('high'),
        setupScript: 'pnpm install',
        dockerCompose: 'services:\n  web:\n    image: node',
        runConfigurations: [
          {
            id: 'admin',
            name: 'Admin application',
            command: 'pnpm dev',
            cwd: 'apps/admin',
            default: true,
            category: 'web',
            services: ['admin'],
            previewService: 'admin',
            scopes: ['admin'],
          },
        ],
        practices: [],
      })

    response.assertStatus(422)
  })
})

function previewManifest(confidence: 'low' | 'medium' | 'high') {
  return {
    version: 1,
    confidence,
    project: { root: '.' },
    setup: [],
    services: [
      {
        id: 'web',
        kind: 'preview',
        image: 'node:22-bookworm',
        command: 'pnpm dev',
        preview: { internalPort: 3000, protocol: 'http', path: '/' },
        healthcheck: { type: 'http', path: '/', timeoutMs: 30_000 },
      },
    ],
    caches: [],
    risks: [],
  }
}

function createUser() {
  return User.create({
    email: `${crypto.randomUUID()}@example.com`,
    password: 'password123',
  })
}

function createProject(userId: string, name: string) {
  return Project.create({
    name,
    repositoryFingerprint: crypto.randomUUID(),
    userId,
  })
}
