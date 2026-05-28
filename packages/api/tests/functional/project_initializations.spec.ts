import Project from '#models/project'
import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'

type InitializationBody = {
  data: {
    initialization: {
      status: string
      clineSessionId: string | null
      setupScript: string | null
      dockerCompose: string | null
      error: string | null
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
        setupScript: '#!/usr/bin/env bash\npnpm install',
        dockerCompose: 'services:\n  web:\n    image: node',
        practices: [
          { practice: 'coding_style', detected: true, comment: 'Functions are concise.' },
          { practice: 'unit_tests', detected: false, comment: 'No test runner found.' },
          { practice: 'layered_architecture', detected: true, comment: 'Modules are separated.' },
          { practice: 'commit_message_convention', detected: false, comment: 'Messages vary.' },
        ],
      })

    completeResponse.assertStatus(200)
    const completed = completeResponse.body() as InitializationBody
    assert.equal(completed.data.initialization?.status, 'done')
    assert.equal(completed.data.initialization?.clineSessionId, 'session-1')
    assert.lengthOf(completed.data.practices, 4)
    assert.isTrue(completed.data.practices.some((practice) => practice.detected))
    assert.isTrue(
      completed.data.practices.every((practice) => practice.enabled === practice.detected)
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
})

function createUser() {
  return User.create({
    email: `${crypto.randomUUID()}@example.com`,
    password: 'password123',
  })
}

function createProject(userId: number, name: string) {
  return Project.create({
    id: crypto.randomUUID(),
    name,
    repositoryFingerprint: crypto.randomUUID(),
    userId,
  })
}
