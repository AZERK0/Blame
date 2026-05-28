import Project from '#models/project'
import ProjectCodePractice from '#models/project_code_practice'
import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'

type PracticeBody = {
  data: {
    practice: string
    detected: boolean
    enabled: boolean
    comment: string
  }
}

type PracticeListBody = {
  data: PracticeBody['data'][]
}

test.group('project code practices', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => testUtils.db().truncate())

  test('lists practices for a project', async ({ client, assert }) => {
    const user = await createUser()
    const project = await createProject(user.id, 'Alpha')

    await createPractice(project.id, 'unit_tests', false, false, 'No test runner found.')
    await createPractice(project.id, 'coding_style', true, true, 'ESLint is configured.')

    const response = await client.get(`/api/v1/projects/${project.id}/code-practices`).loginAs(user)

    response.assertStatus(200)
    const body = response.body() as unknown as PracticeListBody
    assert.lengthOf(body.data, 2)
    assert.equal(body.data[0].practice, 'coding_style')
    assert.equal(body.data[1].practice, 'unit_tests')
  })

  test('updates enabled without changing detected or comment', async ({ client, assert }) => {
    const user = await createUser()
    const project = await createProject(user.id, 'Alpha')

    await createPractice(project.id, 'unit_tests', false, false, 'No test runner found.')

    const response = await client
      .patch(`/api/v1/projects/${project.id}/code-practices/unit_tests`)
      .loginAs(user)
      .json({ enabled: true })

    response.assertStatus(200)
    const body = response.body() as PracticeBody
    assert.equal(body.data.practice, 'unit_tests')
    assert.isFalse(body.data.detected)
    assert.isTrue(body.data.enabled)
    assert.equal(body.data.comment, 'No test runner found.')
  })

  test('rejects practices from another user project', async ({ client }) => {
    const owner = await createUser()
    const otherUser = await createUser()
    const project = await createProject(owner.id, 'Alpha')

    await createPractice(project.id, 'coding_style', true, true, 'ESLint is configured.')

    const listResponse = await client
      .get(`/api/v1/projects/${project.id}/code-practices`)
      .loginAs(otherUser)

    listResponse.assertStatus(404)

    const updateResponse = await client
      .patch(`/api/v1/projects/${project.id}/code-practices/coding_style`)
      .loginAs(otherUser)
      .json({ enabled: false })

    updateResponse.assertStatus(404)
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

function createPractice(
  projectId: string,
  practice: 'coding_style' | 'unit_tests',
  detected: boolean,
  enabled: boolean,
  comment: string
) {
  return ProjectCodePractice.create({
    projectId,
    practice,
    detected,
    enabled,
    comment,
  })
}
